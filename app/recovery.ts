/**
 * Что видит человек, если с хранением что-то не так (D91).
 *  - Сохранённые данные не прочитались → экран восстановления вместо приложения: скачать данные, восстановить из бэкапа, начать заново.
 *  - Запись не удаётся или хранилища нет → красная плашка над экраном с переходом к бэкапу.
 */
import { emptyState, parseState, serializeState } from '../engine/index';
import { ask, download, h, toast } from './dom';
import { getHealth, getState, replaceState, retryPreSimpleCopy, today } from './store';
import { looksLikeNewerVersion } from './persist';

/** Плашка над экраном, пока изменения не сохраняются. null — всё в порядке. */
export function storageBanner(): HTMLElement | null {
  const hl = getHealth();
  if (hl.mode === 'copy-failed') {
    // перенос на новые экраны без копии не начинается (D103): приложение показывает данные, но ничего не сохраняет
    return h(
      'div',
      { class: 'storage-banner', role: 'alert' },
      h('span', null, `Перед обновлением не удалось сохранить копию твоих данных (${hl.error}). Чтобы ничего не потерять, приложение пока ничего не сохраняет.`),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
            const ok = await retryPreSimpleCopy();
            toast(ok ? 'Копия сделана — можно работать' : 'Снова не получилось. Скачай данные и освободи место в браузере', ok ? 'info' : 'error');
          } }, 'Повторить'),
      h('button', { class: 'btn', type: 'button', onclick: () => download(`capital-os-before-update-${today()}.json`, hl.raw) }, 'Скачать данные'),
    );
  }
  if (hl.mode !== 'write-failed' && hl.mode !== 'no-storage') return null;
  const text =
    hl.mode === 'no-storage'
      ? 'Браузер не даёт сохранять данные — после закрытия всё пропадёт.'
      : `Изменения не сохраняются: ${hl.error}.`;
  return h(
    'div',
    { class: 'storage-banner', role: 'alert' },
    h('span', null, text, ' Скачай копию, чтобы не потерять их.'),
    h(
      'button',
      { class: 'btn', type: 'button', onclick: () => download(`capital-os-${today()}.json`, serializeState(getState(), today())) },
      'Скачать копию',
    ),
  );
}

/** Экран вместо приложения, когда сохранённые данные не прочитались. */
export function recoveryScreen(): HTMLElement {
  const hl = getHealth();
  if (hl.mode !== 'unreadable') return h('div');
  const newer = looksLikeNewerVersion(hl.error);
  const input = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden' }) as HTMLInputElement;
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    const r = parseState(await f.text());
    if (!r.ok) return toast(r.error, 'error');
    if (await replaceState(r.value)) toast('Бэкап восстановлен');
  });
  const startOver = async () => {
    const i = await ask({
      title: 'Начать заново?',
      text: `Приложение откроется пустым.${hl.savedAs ? ' Нечитаемые данные останутся копией в этом браузере, но открыть их приложение не сможет.' : ''} Если ещё не скачал их — сначала скачай.`,
      actions: [{ label: 'Начать заново', kind: 'danger' }],
    });
    if (i !== 0) return;
    if (await replaceState(emptyState())) toast('Начинаем заново');
  };
  return h(
    'main',
    { id: 'main', class: 'screen recovery' },
    h('h1', { tabindex: '-1', id: 'screen-title' }, 'Не удалось открыть твои данные'),
    h(
      'div',
      { class: 'badline' },
      newer
        ? 'Данные записала более новая версия приложения, а сейчас открылась старая. Обычно помогает обновить страницу.'
        : 'Сохранённые данные повреждены или в неизвестном формате.',
    ),
    h('p', { class: 'muted' }, 'Мы ничего не стёрли и ничего не будем записывать, пока ты не выберешь, что делать.', ` Причина: ${hl.error}.`),
    h(
      'div',
      { class: 'stack' },
      newer ? h('button', { class: 'btn primary wide', type: 'button', onclick: () => location.reload() }, 'Обновить страницу') : null,
      h(
        'button',
        { class: `btn wide${newer ? '' : ' primary'}`, type: 'button', onclick: () => download(`capital-os-unreadable-${today()}.json`, hl.raw) },
        'Скачать сохранённые данные',
      ),
      h('label', { class: 'btn wide file-btn' }, 'Восстановить из бэкапа', input),
      h('button', { class: 'btn danger wide', type: 'button', onclick: startOver }, 'Начать заново'),
    ),
  );
}
