/**
 * Установка приложения (D73): кнопка «Установить» там, где браузер её даёт (Chrome, Edge),
 * и понятная инструкция там, где не даёт. Ничего не отправляет в сеть.
 */
import { h } from './dom';
import { info } from './ui';

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

const isPhone = (): boolean => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const isIos = (): boolean => /iPhone|iPad|iPod/i.test(navigator.userAgent);

export function installBlock(): HTMLElement {
  const status = standalone()
    ? h('div', { class: 'okline' }, '✓ Ты уже в установленном приложении')
    : installedNow
      ? h('div', { class: 'okline' }, '✓ Установлено — значок появился на экране')
      : deferred
        ? h(
            'button',
            {
              class: 'btn primary wide',
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
          )
        : h(
            'div',
            { class: 'card stack' },
            h('strong', null, 'Как установить'),
            isIos()
              ? h('p', null, 'В Safari нажми «Поделиться» внизу экрана и выбери «На экран „Домой“».')
              : isPhone()
                ? h('p', null, 'В Chrome открой меню ⋮ и выбери «Добавить на главный экран» или «Установить приложение».')
                : h('p', null, 'В Chrome или Edge — значок установки справа в адресной строке или меню ⋮ → «Установить…». Firefox на компьютере установку не поддерживает.'),
          );
  return h(
    'div',
    { class: 'stack' },
    h('p', { class: 'muted' }, 'Отдельный значок и своё окно, без вкладки браузера. Данные те же — они остаются на этом устройстве.', info('install')),
    status,
    h('p', { class: 'muted' }, offlineReady() ? 'Без интернета: работает ✓' : 'Без интернета: заработает после следующего открытия с интернетом.'),
  );
}
