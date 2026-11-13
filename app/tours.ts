/** Готовые подсказки поверх интерфейса (D191): разница режимов и «как читать профиль». */
import { act, getState, setPreviewMode, update } from './store';
import { go } from './main';
import { startTour, tourActive, type TourStep } from './tour';
import { isSimpleMode } from '../engine/index';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function openScreen(hash: string): Promise<void> {
  if (location.hash.split('~')[0] !== hash) {
    go(hash);
    await wait(120);
  }
  window.scrollTo(0, 0);
}

/** Отметить подсказку как показанную (чтобы сама не всплывала второй раз). */
export function markTour(id: string): void {
  if ((getState().settings.toursSeen ?? []).includes(id)) return;
  void update((s) => ({ ...s, settings: { ...s.settings, toursSeen: [...(s.settings.toursSeen ?? []), id] } }));
}
export const tourSeen = (id: string): boolean => (getState().settings.toursSeen ?? []).includes(id);

/**
 * «Чем отличаются режимы» — на настоящем «Обзоре»: показываем простой, потом переключаем на полный прямо под подсветкой,
 * в конце человек выбирает режим. Сам режим во время показа не сохраняется.
 */
export async function modeTour(): Promise<void> {
  const hasData = !!getState().imported;
  const was = isSimpleMode(getState().settings);
  const choose = (simple: boolean) => act((s) => ({ ...s, settings: { ...s.settings, uiMode: simple ? 'simple' : 'full' } }), simple ? 'Простой режим включён' : 'Полный режим включён');
  const steps: TourStep[] = hasData
    ? [
        { before: () => setPreviewMode('simple'), target: '[data-tour=hero]', title: 'Главное — в обоих режимах', text: 'Сколько свободно до дохода. Это число и все расчёты одинаковые в простом и полном режиме.' },
        { before: () => setPreviewMode('simple'), target: '[data-tour=details]', title: 'Простой режим', text: 'Платежи на месяц, капитал и все счета спрятаны сюда, под «Подробнее». На экране — только то, что нужно каждый день.' },
        { before: () => setPreviewMode('full'), target: ['[data-tour=payments]', '[data-tour=details]'], title: 'Полный режим', text: 'Те же платежи — сразу на экране, без лишнего нажатия. На Профиле, Прогнозе и Целях так же: больше блоков открыто.' },
      ]
    : [{ title: 'Два режима', text: 'Простой — на экранах только главное, остальное под «Подробнее». Полный — всё сразу. Расчёты одинаковые.' }];
  steps.push({
    before: () => setPreviewMode(null),
    title: 'Какой оставить?',
    text: `Сейчас включён ${was ? 'простой' : 'полный'}. Поменять можно в любой момент: «Ещё → Настройки».`,
    choices: [
      { label: 'Простой', primary: was, run: () => choose(true) },
      { label: 'Полный', primary: !was, run: () => choose(false) },
    ],
  });
  // сначала экран, потом подсказка: смена адреса во время подсказки читается как «назад» и закрыла бы её
  if (hasData) await openScreen('#/overview');
  startTour(steps, { label: 'Простой и полный режим', onEnd: () => setPreviewMode(null) });
}

/** «Как читать профиль» — по блокам настоящего экрана. Сам открывается один раз при первом заходе на «Профиль». */
export async function profileTour(): Promise<void> {
  markTour('profile');
  await openScreen('#/position');
  startTour(
    [
      { target: '[data-tour=level]', title: 'Твоя ступень', text: 'Где ты сейчас из пяти ступеней — от «Денег не хватает» до «Могу не работать». Все ступени — по кнопке ниже.' },
      { target: '[data-tour=dirs]', title: 'Три направления', text: 'Сейчас, как меняется и насколько защищено будущее. Оранжевая черта — порог 60: пока полоска короче, следующая ступень закрыта. Нажми на направление — увидишь, из чего оно.' },
      { target: ['[data-tour=weak]', '[data-tour=path]'], title: 'С чего начать', text: 'Самое слабое место и что нужно, чтобы подняться выше. Это и есть твой следующий шаг.' },
      { target: '[data-tour=money]', title: 'Деньги', text: 'Капитал — всё, что есть, минус долги. Запас — сколько месяцев проживёшь без дохода. Нажми ⓘ — подробнее.' },
    ],
    { label: 'Как читать профиль' },
  );
}

/**
 * Подсказка открывается сама один раз (D193): ждёт, пока закроется окно «Что нового» и человек будет на нужном экране.
 * Окно «Что нового» в этот запуск уже показывали — не наваливаем вторую подсказку подряд, она дождётся следующего запуска.
 */
let shownThisLaunch = false;
export const noteWhatsNewShown = (): void => void (shownThisLaunch = true);
const scheduled = new Set<string>();
export function autoTour(id: string, hash: string, run: () => void | Promise<void>): void {
  if (tourSeen(id) || scheduled.has(id) || shownThisLaunch) return;
  scheduled.add(id);
  let tries = 0;
  const tick = () => {
    tries += 1;
    const busy = tourActive() || !!document.querySelector('.modal-back, .sheet');
    if (tourSeen(id) || shownThisLaunch || !location.hash.startsWith(hash)) return void scheduled.delete(id);
    if (busy) return void (tries < 20 ? setTimeout(tick, 1500) : scheduled.delete(id));
    markTour(id);
    void run();
  };
  setTimeout(tick, 900);
}

// ───────────────── инструкции «Покажу на экране» (D193) ─────────────────

/** Сколько можно тратить сегодня — на «Обзоре». */
export async function spendTour(): Promise<void> {
  markTour('overview');
  await openScreen('#/overview');
  startTour(
    [
      { target: '[data-tour=hero]', title: 'Сколько можно тратить', text: 'Свободно до следующего дохода — уже после еды, дороги, подписок и платежей по долгам. «В день сверху» — сколько можно добавить к обычным тратам.' },
      { target: '[data-tour=cells]', title: 'Это не «можно тратить»', text: 'Всего на счетах — вместе с копилками и деньгами, отложенными на цели. Их приложение не считает свободными.' },
      { target: ['[data-tour=payments]', '[data-tour=details]'], title: 'Ближайшие платежи', text: 'Платежи по долгам и рассрочкам на 30 дней. Они уже вычтены из главного числа.' },
      { target: '.trust', title: 'Можно ли верить цифрам', text: 'Метка вверху: зелёная — всё сошлось, жёлтая — данных мало или есть вопросы. Нажми — увидишь, что сделать.' },
    ],
    { label: 'Сколько можно тратить' },
  );
}

/** Обновить данные из MoneyManager. */
export async function updateTour(): Promise<void> {
  await openScreen('#/more');
  startTour(
    [
      { title: 'Шаг 1. В MoneyManager', text: '«Настройки» → «Данные» → «Резервное копирование» → «Создать резервную копию».' },
      { title: 'Шаг 2. Поделиться', text: 'В окне «Резервная копия создана» нажми «Поделиться» и выбери Capital OS — файл сразу откроется здесь.' },
      { target: '[data-tour=update]', title: 'Нет Capital OS в списке?', text: 'Нажми в MoneyManager «Сохранить в загрузки», а здесь — «Обновить данные»: сразу откроется выбор файла.' },
      { title: 'Шаг 3. Сверка', text: 'Приложение сверит каждый счёт с MoneyManager. Всё сошлось — «Принять». Цели, доходы и разметка при этом не теряются.' },
    ],
    { label: 'Обновить данные' },
  );
}

/** Пришла зарплата или стипендия. */
export async function arrivedTour(): Promise<void> {
  await openScreen('#/more');
  startTour(
    [
      { target: '[data-tour=arrived-tile]', title: 'Пришли деньги', text: 'Сначала загрузи свежий бэкап: приложение само найдёт приход, и на «Обзоре» появится карточка «Пришло … — Распределить». Или открой отсюда.' },
      { title: 'Сколько отложить', text: 'Приложение покажет «Можно отложить» по каждой цели и сколько останется на жизнь до следующих денег. Сначала платежи, потом цели по порядку.' },
      { title: 'Переведи сам', text: 'Само приложение деньги не двигает. Переведи суммы на копилку в банке и нажми «Перевёл — подтвердить».' },
    ],
    { label: 'Пришли деньги' },
  );
}

/** Накопить на цель. */
export async function goalTour(): Promise<void> {
  await openScreen('#/goals');
  startTour(
    [
      { target: ['[data-tour=templates]', '[data-tour=goal-new]'], title: 'Новая цель', text: 'Выбери вариант или «＋ Цель»: название, сумма и, если важно, срок.' },
      { target: ['[data-tour=goal-list]', '[data-tour=cushion]'], title: 'Успеваешь ли', text: 'У цели со сроком сразу видно: «успеваешь» или сколько добавить в месяц. Кто выше в списке — получает деньги раньше.' },
      { title: 'Деньги не двигаются', text: 'Деньги остаются на твоих счетах — за целью они только закрепляются. Закрепить — кнопкой в карточке цели.' },
    ],
    { label: 'Накопить на цель' },
  );
}

/** Потяну ли покупку или рассрочку. */
export async function planTour(): Promise<void> {
  await openScreen('#/forecast');
  startTour(
    [
      { target: '[data-tour=plan]', title: 'Планирую…', text: 'Покупка, рассрочка, переезд, новая работа — выбери и заполни 2–3 поля.' },
      { target: '[data-tour=fc-hero]', title: 'Что станет с деньгами', text: 'Покажу, сколько будет на руках, хватит ли денег в каждом месяце и какие цели сдвинутся.' },
      { target: ['[data-tour=calc]', '[data-tour=fc-chart]'], title: 'Если не тянешь', text: '«Где сэкономить» и «Набрать запас» посчитают, сколько урезать или откладывать. Подходит — «Добавить в план».' },
    ],
    { label: 'Потяну ли покупку' },
  );
}

/** Не потерять данные. */
export async function saveTour(): Promise<void> {
  await openScreen('#/more');
  startTour(
    [
      { target: '[data-tour=save]', title: 'Копия приложения', text: 'Цели, разметка и ответы хранятся только в этом браузере. MoneyManager их не вернёт. Сохраняй копию раз в две недели и перед сменой телефона.' },
      { title: 'На новом телефоне', text: '«Ещё → Сохранить копию → Восстановить из файла» — и всё на месте.' },
    ],
    { label: 'Не потерять данные' },
  );
}

/** Почему цифры странные. */
export async function trustTour(): Promise<void> {
  await openScreen('#/overview');
  startTour(
    [
      { target: '.trust', title: 'Метка точности', text: 'Нажми на неё — приложение покажет, чего не хватает: истории, разметки или ответа на вопрос.' },
      { title: 'Как сделать точнее', text: 'Загрузи свежий бэкап, отметь обязательные траты и ответь на вопросы в «Нужно решение». С 3 месяцами истории цифры станут заметно точнее.' },
    ],
    { label: 'Цифры кажутся странными' },
  );
}

/** Список для «Как пользоваться → Покажу на экране» — по частоте нужды. */
export const HOW_TO: { title: string; steps: number; run: () => void | Promise<void> }[] = [
  { title: 'Сколько можно тратить сегодня', steps: 4, run: spendTour },
  { title: 'Обновить данные из MoneyManager', steps: 4, run: updateTour },
  { title: 'Пришла зарплата — что делать', steps: 3, run: arrivedTour },
  { title: 'Накопить на цель', steps: 3, run: goalTour },
  { title: 'Потяну ли покупку или рассрочку', steps: 3, run: planTour },
  { title: 'Не потерять данные', steps: 2, run: saveTour },
  { title: 'Цифры кажутся странными', steps: 2, run: trustTour },
];
