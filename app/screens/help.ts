/**
 * «Как пользоваться» (D94, сокращено в D186): что умеет приложение карточками, пять коротких задач, словарь.
 * Построено по задачам человека, а не по функциям; словарь — те же тексты, что в кнопках ⓘ (один источник).
 * Длинные объяснения живут в «Как посчитано» у самих чисел и в кнопках ⓘ — здесь их не повторяем.
 */
import { h } from '../dom';
import { HELP } from '../help-text';
import { sub } from '../ui';
import { infoCard } from '../whatsnew';
import { CAPABILITIES } from '../whatsnew-data';

const SEEN_KEY = 'capital-os.help-seen';

/** Видел ли человек справку (для подсказки «Впервые здесь?» на «Обзоре»). Хранилище браузера может быть недоступно — тогда считаем, что видел. */
export function helpSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markHelpSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* не страшно: подсказка просто покажется ещё раз */
  }
}

/** Одна задача: вопрос человека → до трёх коротких шагов. */
function task(q: string, steps: string[], tip?: string): HTMLElement {
  return h(
    'details',
    { class: 'fold help-task', 'data-key': `help:${q}` },
    h('summary', null, q),
    h('ol', { class: 'help-steps' }, steps.map((s) => h('li', null, s))),
    tip ? h('p', { class: 'muted' }, tip) : null,
  );
}

export function renderHelp(): HTMLElement {
  markHelpSeen();
  const key = (t: string) => t.replace(/[«»]/g, '');
  const terms = Object.values(HELP).sort((a, b) => key(a.title).localeCompare(key(b.title), 'ru'));
  return h(
    'div',
    { class: 'screen help' },
    h('p', { class: 'help-lead' }, 'Capital OS — помощник к MoneyManager. Учёт ты ведёшь там, а сюда загружаешь бэкап и видишь то, чего там нет. Ничего не переводит и не трогает счета; данные остаются на этом устройстве.'),
    sub('Что умеет'),
    h('div', { class: 'wn-list' }, CAPABILITIES.map((c) => infoCard(c))),
    sub('Как сделать'),
    h(
      'div',
      { class: 'stack tight' },
      task('Загрузить свежие данные', ['В MoneyManager сделай резервную копию (файл .mmbackup).', 'Здесь: «Ещё → Обновить данные из MoneyManager» или «Поделиться → Capital OS».', 'Если все счета сошлись — «Принять импорт».'], 'Разметка, цели, доходы и рассрочки остаются.'),
      task('Пришли деньги — что с ними делать', ['Загрузи свежий бэкап и открой «Обзор»: приложение само найдёт приход.', '«Да, посчитай» покажет, сколько отложить на каждую цель.', 'Переведи сумму на копилку в банке и нажми «Перевёл — подтвердить».'], 'Приложение само ничего не переводит.'),
      task('Хочу накопить на что-то', ['«Цели → ＋ Цель»: название, сумма, срок (срок можно не указывать).', 'Сразу видно: «успеваешь» или сколько нужно ещё в месяц.'], 'Кто выше в списке — получает деньги раньше.'),
      task('Что будет, если…', ['«Прогноз → Планирую…»: работа, переезд, покупка, рассрочка, потеря дохода.', 'Заполни 2–3 поля, нажми «Посчитать» и, если подходит, «Добавить в план».']),
      task('Не потерять настройки', ['Данные хранятся только в этом браузере.', '«Ещё → Сохранить копию приложения» — раз в две недели и перед сменой телефона.'], 'На новом устройстве: «Восстановить из файла».'),
    ),
    h(
      'details',
      { class: 'fold', 'data-key': 'help:strange' },
      h('summary', null, 'Если что-то непонятно'),
      h(
        'ul',
        { class: 'help-list' },
        h('li', null, h('strong', null, 'Откуда число?'), ' Под ним «Как посчитано ›»; кружок ⓘ объясняет слово.'),
        h('li', null, h('strong', null, 'Цифры странные.'), ' Посмотри метку «Точность» вверху: мало истории или бэкап не сошёлся — она скажет.'),
        h('li', null, h('strong', null, 'Категория без названия.'), ' «Ещё → Данные → Раскладка трат» — нажми на неё и назови.'),
        h('li', null, h('strong', null, 'Прогноз спрашивает «Повторятся?»'), ' — это про траты, которые были 1–2 раза за год; ответь, и прогноз станет точнее.'),
      ),
    ),
    h(
      'details',
      { class: 'fold', 'data-key': 'help:dictionary' },
      h('summary', null, `Словарь — что значат слова в приложении (${terms.length})`),
      h('div', { class: 'stack tight' }, terms.map((t) => h('details', { class: 'fold', 'data-key': `help:term:${t.title}` }, h('summary', null, t.title), h('p', null, t.text)))),
    ),
  );
}
