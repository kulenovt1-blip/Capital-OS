/** «Ещё»: что ждёт внимания → главное действие → мои данные → приложение. */
import { h } from '../dom';
import { getState, today } from '../store';
import { ov, progress, steps } from '../ctx';
import { fmt, fmtDay, nWord, row, rows, sub, toggle } from '../ui';
import { act } from '../store';
import { isInstalled } from '../install';
import { fontPref, themePref } from '../theme';
import { daysBetween, essentialMarkupMissing, isSimpleMode } from '../../engine/index';
import { sheetHref } from '../main';
import { backupReminder } from '../persist';
import { persistStatus } from '../protect';
import { openWhatsNew } from '../whatsnew';
import { modeTour } from '../tours';
import { pickBackup } from './import';
import { tile, tiles } from '../tiles';

export const APP_VERSION = '0.7.0';
declare const __BUILD__: { sha: string; date: string } | undefined;
/** «сборка a1b2c3d · 11.11» — по хэшу видно, какая версия открыта; в разработке — «разработка». */
export const buildLabel = (): string => (typeof __BUILD__ === 'undefined' ? 'разработка' : `сборка ${__BUILD__.sha} · ${__BUILD__.date.slice(8, 10)}.${__BUILD__.date.slice(5, 7)}`);

export function renderMore(): HTMLElement {
  const st = getState();
  const o = ov();
  const p = progress();
  const all = steps();
  const setupOpen = p.done < p.total;
  const review = all.find((s) => s.id === 'accounts');
  const accountsWait = !!review && !review.done && !review.locked;
  const accounts = (st.imported?.accounts ?? []).filter((a) => !a.removed).length + st.manualAccounts.length;
  const found = o.installments.suggestions.length;
  const backupAge = st.lastBackupAt ? daysBetween(st.lastBackupAt, today()) : null;
  const bakRem = backupReminder(backupAge, o.hasData, persistStatus());
  const reconcileBad = o.hasData && !o.reconcile?.ok;
  const text = fontPref() === '1' ? 'крупный' : 'обычный';
  const bak = st.lastBackupAt ? `бэкап ${fmtDay(st.lastBackupAt)}` : 'бэкап не скачивался';
  const noIncome = !st.settings.incomeSchedule.length;
  const markup = o.hasData && essentialMarkupMissing(o);
  // «Требует внимания» (D193): цветная точка и короткая фраза; объяснение — на экране, куда ведёт строка
  const att = (title: string, href: string, level: 'warn' | 'bad', value?: string) => row({ title, href, value, lead: h('span', { class: `adot ${level}`, 'aria-hidden': 'true' }) });
  const attention = [
    reconcileBad ? att('Сверка не сошлась', '#/data', 'bad') : null,
    bakRem.show ? att(st.lastBackupAt ? 'Пора сохранить копию' : 'Сохрани копию — её ещё нет', '#/backup', bakRem.level === 'bad' ? 'bad' : 'warn') : null,
    setupOpen ? att('Настройка', '#/setup', 'warn', o.hasData ? `${p.done} из ${p.total}` : 'начать') : null,
    markup ? att('Отметь обязательные траты', '#/markup', 'warn') : null,
    accountsWait ? att('Подтверди счета', '#/accounts', 'warn') : null,
    noIncome ? att('Укажи доходы', '#/incomes', 'warn') : null,
    found ? att('Найден долг — проверь', '#/debts', 'warn', String(found)) : null,
  ].filter(Boolean) as HTMLElement[];
  void bak;
  return h(
    'div',
    { class: 'screen' },
    attention.length ? h('div', { class: 'stack' }, sub('Требует внимания'), rows(...attention)) : null,
    // частые действия — плитками (D193); «Обновить данные» сразу открывает выбор файла (D192)
    sub('Действия'),
    tiles(
      tile({ icon: 'arrive', title: 'Пришли деньги', href: '#/income', tour: 'arrived-tile' }),
      tile({ icon: 'upload', title: 'Обновить данные', sub: !o.hasData ? 'из MoneyManager' : `импорт ${fmtDay(st.importedAt ?? today())}`, onClick: pickBackup, tour: 'update', warn: reconcileBad }),
      tile({ icon: 'save', title: 'Сохранить копию', sub: st.lastBackupAt ? `копия ${fmtDay(st.lastBackupAt)}` : 'ещё нет', href: '#/backup', tour: 'save', warn: bakRem.show }),
      o.hasData ? tile({ icon: 'calendar', title: 'Итоги месяцев', href: '#/months' }) : null,
    ),
    h(
      'div',
      { class: 'stack' },
      sub('Мои данные'),
      rows(
        row({ title: 'Счета', value: o.hasData ? String(accounts) : undefined, href: '#/accounts' }),
        row({ title: 'Доходы', value: noIncome ? 'нет' : String(st.settings.incomeSchedule.length), href: '#/incomes' }),
        row({ title: 'Долги и рассрочки', value: st.obligations.length ? String(st.obligations.length) : 'нет', href: '#/debts' }),
        isSimpleMode(st.settings) ? null : row({ title: 'Разметка трат', href: '#/data' }),
      ),
    ),
    h(
      'div',
      { class: 'stack' },
      sub('Приложение'),
      rows(row({ title: 'Настройки', href: '#/prefs' }), row({ title: 'Что нового', onClick: openWhatsNew }), row({ title: 'Как пользоваться', href: '#/help' })),
    ),
    h('p', { class: 'foot-note' }, `Capital OS · версия ${APP_VERSION} · ${buildLabel()}`),
  );
}

/** «Данные»: импорт из MoneyManager и бэкап приложения — оба про файлы с данными. */
export function renderData(): HTMLElement {
  const st = getState();
  const o = ov();
  const unclassified = o.classification?.unclassified.length ?? 0;
  const reconcileBad = o.hasData && !o.reconcile?.ok;
  return h(
    'div',
    { class: 'screen' },
    rows(
      row({ title: 'Импорт из MoneyManager', sub: !o.hasData ? 'данных пока нет' : `последний ${fmtDay(st.importedAt ?? today())} · ${reconcileBad ? 'сверка: расхождение' : 'сверка ✓'}`, href: '#/import', mark: reconcileBad }),
      row({ title: 'Бэкап приложения', sub: st.lastBackupAt ? `последний ${fmtDay(st.lastBackupAt)}` : 'ещё не скачивался', href: '#/backup' }),
      o.hasData ? row({ title: 'Раскладка трат', sub: 'повседневное, регулярное, разовое, долги', href: '#/baskets' }) : null,
      o.hasData ? row({ title: 'Разметка подробно', sub: unclassified ? `не размечено: ${unclassified}` : 'типы операций и правила', href: '#/markup', mark: unclassified > 0 }) : null,
    ),
    h('p', { class: 'one-line' }, 'Импорт — свежие операции из MoneyManager. Бэкап — копия всего, что ты настроил здесь.'),
  );
}

/** «Настройки»: вид, установка (если ещё не установлено), редкое и для продвинутых. */
export function renderPrefs(): HTMLElement {
  const text = fontPref() === '1' ? 'крупный' : 'обычный';
  const st = getState();
  const details = !!st.settings.showDetails;
  const simple = isSimpleMode(st.settings);
  const p = st.settings.position;
  return h(
    'div',
    { class: 'screen' },
    rows(
      row({
        title: 'Простой режим',
        sub: 'на экранах только главное, остальное — в «Подробнее»',
        value: toggle(simple, (v) => void act((s) => ({ ...s, settings: { ...s.settings, uiMode: v ? 'simple' : 'full' } }), v ? 'Простой режим включён' : 'Полный режим включён'), 'Простой режим'),
        chevron: false,
      }),
      row({ title: 'Чем отличаются режимы', sub: 'покажу на настоящем экране', onClick: () => void modeTour() }),
      row({
        title: 'Сразу показывать подробности',
        sub: 'капитал, все счета и числа «Подробнее» открыты на каждом экране',
        value: toggle(details, (v) => void act((s) => ({ ...s, settings: { ...s.settings, showDetails: v } }), v ? 'Подробности открыты сразу' : 'Подробности — по нажатию'), 'Сразу показывать подробности'),
        chevron: false,
      }),
      st.imported ? row({ title: 'Пройти первую настройку заново', sub: 'доходы, копилки, цели — три шага', href: '#/start' }) : null,
    ),
    rows(
      row({ title: 'О тебе', sub: p?.age || p?.desiredMonthly ? [p.age ? `${p.age} лет` : '', p.desiredMonthly ? `хочу тратить ${fmt(p.desiredMonthly)} в месяц` : ''].filter(Boolean).join(' · ') : 'возраст и сколько хочешь тратить в месяц', href: sheetHref('you') }),
      row({ title: 'Вид', sub: `тема: ${themePref() === 'auto' ? 'как в системе' : themePref() === 'dark' ? 'тёмная' : 'светлая'} · текст: ${text}`, href: '#/view' }),
      isInstalled() ? null : row({ title: 'Установить как приложение', sub: 'значок на экране, работает без интернета', href: '#/install' }),
      simple ? null : row({ title: 'Редкое', sub: 'долги на начало учёта, ручные счета, поправки', href: '#/rare' }),
      simple ? null : row({ title: 'Для продвинутых', sub: 'правила разметки, параметры, сценарии', href: '#/advanced' }),
    ),
  );
}
