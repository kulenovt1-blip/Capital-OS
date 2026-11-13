/** Готовые подсказки поверх интерфейса (D191): разница режимов и «как читать профиль». */
import { act, getState, setPreviewMode, update } from './store';
import { go } from './main';
import { startTour, type TourStep } from './tour';
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
