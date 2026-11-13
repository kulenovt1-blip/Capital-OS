/**
 * Подсказки поверх настоящего интерфейса (D191): экран затемняется, нужный блок подсвечивается «окном» в затемнении,
 * рядом — пузырь с пояснением. Подсветка плавно переезжает от блока к блоку. Живёт вне #app: перерисовка экрана
 * её не сбивает — цель ищется заново по селектору при каждом пересчёте позиции.
 */
import { h } from './dom';

export interface TourStep {
  /** Селекторы цели по порядку: берётся первый найденный на экране. Нет — пузырь по центру. */
  target?: string | string[];
  title: string;
  text: string;
  /** Что сделать перед шагом (сменить режим показа, открыть экран). */
  before?: () => void | Promise<void>;
  /** Кнопки последнего шага вместо «Понятно». */
  choices?: { label: string; primary?: boolean; run: () => void | Promise<void> }[];
}

let active: (() => void) | null = null;
export const tourActive = (): boolean => active !== null;

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export function startTour(steps: TourStep[], opts: { label: string; onEnd?: () => void } = { label: 'Подсказка' }): void {
  if (active || !steps.length) return;
  let i = 0;
  const spot = h('div', { class: 'tour-spot' });
  const title = h('div', { class: 'tour-title' });
  const text = h('p', { class: 'tour-text' });
  const dots = h('div', { class: 'tour-dots', 'aria-hidden': 'true' }, steps.map(() => h('span')));
  const btns = h('div', { class: 'tour-btns' });
  const tip = h('div', { class: 'tour-tip', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label, 'aria-live': 'polite' }, h('button', { class: 'tour-x', type: 'button', 'aria-label': 'Закрыть' }, '×'), title, text, h('div', { class: 'tour-foot' }, dots, btns));
  const arrow = h('div', { class: 'tour-arrow' });
  tip.appendChild(arrow);
  const layer = h('div', { class: 'tour-layer' }, spot, tip);

  const targetEl = (): HTMLElement | null => {
    const t = steps[i]!.target;
    for (const s of t === undefined ? [] : Array.isArray(t) ? t : [t]) {
      const el = document.querySelector<HTMLElement>(`#app ${s}`);
      if (el && el.getClientRects().length) return el;
    }
    return null;
  };

  const place = () => {
    const el = targetEl();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(360, vw - 32);
    tip.style.width = `${w}px`;
    if (!el) {
      spot.classList.add('none');
      spot.style.cssText = `top:${vh / 2}px;left:${vw / 2}px;width:0;height:0`;
      tip.style.left = `${(vw - w) / 2}px`;
      tip.style.top = `${Math.max(16, (vh - tip.offsetHeight) / 2)}px`;
      arrow.style.display = 'none';
      return;
    }
    spot.classList.remove('none');
    const r = el.getBoundingClientRect();
    const pad = 6;
    const top = Math.max(8, r.top - pad);
    const bottom = Math.min(vh - 8, r.bottom + pad);
    spot.style.cssText = `top:${top}px;left:${Math.max(8, r.left - pad)}px;width:${Math.min(vw - 16, r.width + pad * 2)}px;height:${Math.max(0, bottom - top)}px`;
    const th = tip.offsetHeight;
    const below = vh - bottom - 14 >= th;
    const above = top - 14 >= th;
    const left = Math.min(Math.max(16, r.left + r.width / 2 - w / 2), vw - w - 16);
    tip.style.left = `${left}px`;
    // не влезает ни сверху, ни снизу (блок выше экрана) — пузырь у нижнего края поверх блока
    tip.style.top = `${below || !above ? Math.min(bottom + 14, vh - th - 16) : top - 14 - th}px`;
    arrow.style.display = below || above ? '' : 'none';
    arrow.className = `tour-arrow ${below || !above ? 'up' : 'down'}`;
    arrow.style.left = `${Math.min(Math.max(20, r.left + r.width / 2 - left), w - 20)}px`;
  };

  const show = async () => {
    const s = steps[i]!;
    tip.classList.add('switching');
    await s.before?.();
    await frame();
    const el = targetEl();
    if (el) {
      const r = el.getBoundingClientRect();
      // блок под нижним меню или выше экрана — прокрутить, чтобы подсветка и пузырь поместились
      if (r.top < 90 || r.bottom > window.innerHeight - 260) el.scrollIntoView({ block: r.height > window.innerHeight * 0.5 ? 'start' : 'center' });
      await frame();
    }
    title.textContent = s.title;
    text.textContent = s.text;
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    btns.replaceChildren();
    const last = i === steps.length - 1;
    tip.classList.toggle('has-choices', !!(last && s.choices));
    if (i > 0) btns.append(h('button', { class: 'btn link', type: 'button', onclick: () => ((i -= 1), void show()) }, 'Назад'));
    if (last && s.choices) for (const c of s.choices) btns.append(h('button', { class: `btn${c.primary ? ' primary' : ''}`, type: 'button', onclick: async () => (close(), await c.run()) }, c.label));
    else btns.append(h('button', { class: 'btn primary', type: 'button', onclick: () => (last ? close() : ((i += 1), void show())) }, last ? 'Понятно' : 'Далее'));
    place();
    tip.classList.remove('switching');
    (btns.lastElementChild as HTMLElement | null)?.focus({ preventScroll: true });
  };

  let pushed = false;
  const remove = () => {
    if (!active) return;
    active = null;
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', onKey);
    clearInterval(timer);
    layer.classList.add('closing');
    setTimeout(() => layer.remove(), 200);
    opts.onEnd?.();
  };
  const close = () => (pushed ? history.back() : remove());
  // «назад» телефона закрывает подсказку; переходы внутри подсказки она переживает, если адрес не менялся
  const startHash = location.hash;
  const onPop = () => {
    if (location.hash === startHash) remove();
    else {
      pushed = false;
      remove();
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  // экран перерисовывается сам (данные, режим) — подсветка догоняет блок
  const timer = setInterval(place, 400);

  tip.querySelector('.tour-x')!.addEventListener('click', close);
  document.body.appendChild(layer);
  try {
    history.pushState({ capitalTour: true }, '');
    pushed = true;
  } catch {
    /* закрываем кнопками */
  }
  window.addEventListener('popstate', onPop);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  document.addEventListener('keydown', onKey);
  active = close;
  void show();
}
