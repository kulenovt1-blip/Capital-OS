/**
 * Установка приложения (D73): кнопка «Установить» там, где браузер её даёт (Chrome, Edge),
 * и понятная инструкция там, где не даёт. Ничего не отправляет в сеть.
 */
import { h, section } from './dom';
import { guide, info } from './ui';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

/** Вызывается один раз при старте: браузер сообщает о возможности установки очень рано. */
export function initInstall(onChange: () => void): void {
  listeners.add(onChange);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installedNow = true;
    changed();
  });
}

const standalone = (): boolean => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const offlineReady = (): boolean => 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;

export function installBlock(): HTMLElement {
  const status = standalone()
    ? h('p', null, 'Ты уже в установленном приложении.')
    : installedNow
      ? h('p', null, 'Установлено. Значок появился в меню «Пуск» и на рабочем столе (если ты разрешил).')
      : deferred
        ? h(
            'div',
            { class: 'row' },
            h(
              'button',
              {
                class: 'btn primary',
                type: 'button',
                onclick: async () => {
                  const p = deferred;
                  if (!p) return;
                  await p.prompt();
                  const r = await p.userChoice;
                  if (r.outcome === 'accepted') installedNow = true;
                  deferred = null;
                  changed();
                },
              },
              'Установить Capital OS',
            ),
          )
        : h(
            'ul',
            { class: 'plain' },
            h('li', null, 'Chrome: значок установки справа в адресной строке или меню ⋮ → «Трансляция, сохранение и отправка» → «Установить…».'),
            h('li', null, 'Edge: значок установки в адресной строке или меню … → «Приложения» → «Установить…».'),
            h('li', null, 'Firefox на компьютере установку не поддерживает — открой адрес в Chrome или Edge.'),
          );
  return section(
    h('span', null, 'Установить приложение', info('install')),
    guide(
      'Capital OS ставится как отдельная программа: свой значок, своё окно, без вкладки браузера. Данные те же — они в браузере для этого адреса.',
      'По желанию. Чтобы установленное приложение открывалось без командной строки, хотя бы раз запусти его командой «npm run app» (а не «npm run dev»): тогда оболочка сохранится на компьютере.',
    ),
    status,
    h('p', { class: 'muted' }, offlineReady() ? 'Работа без сервера: включена — приложение откроется, даже если командная строка закрыта.' : 'Работа без сервера: выключена — сейчас приложение запущено в режиме разработки («npm run dev»). Для работы без командной строки запусти «npm run app» и открой этот адрес ещё раз.'),
    h('p', { class: 'muted' }, 'На телефон так поставить нельзя: телефон не видит localhost на ноутбуке. Для телефона приложение нужно разместить по адресу https — данные при этом всё равно останутся на устройстве. Это отдельный шаг.'),
  );
}
