/** «Ещё» (D81): плитки 2×N со статусом — всё, что нужно не каждый день. */
import { h } from '../dom';
import { getState, today } from '../store';
import { ov, progress, steps } from '../ctx';
import { fmtDay, nWord, row, rows } from '../ui';
import { isInstalled } from '../install';
import { themePref } from '../theme';
import { daysBetween } from '../../engine/index';

export const APP_VERSION = '0.4.0';

function tile(href: string, title: string, status: string, level: '' | 'warn' | 'bad' = ''): HTMLElement {
  return h('a', { class: `tile${level ? ` ${level}` : ''}`, href }, h('span', { class: 'tt' }, title), h('span', { class: 'ts' }, status));
}

export function renderMore(): HTMLElement {
  const st = getState();
  const o = ov();
  const p = progress();
  const all = steps();
  const setupOpen = p.done < p.total;
  const unclassified = o.classification?.unclassified.length ?? 0;
  const review = all.find((s) => s.id === 'accounts');
  const accounts = (st.imported?.accounts ?? []).filter((a) => !a.removed).length + st.manualAccounts.length;
  const found = o.installments.suggestions.length;
  const backupAge = st.lastBackupAt ? daysBetween(st.lastBackupAt, today()) : null;
  const reconcileBad = o.hasData && !o.reconcile?.ok;
  const theme = { auto: 'как в телефоне', light: 'светлая', dark: 'тёмная' }[themePref()];
  const imp = !o.hasData ? 'данных нет' : `импорт ${fmtDay(st.importedAt ?? today())}${reconcileBad ? ' · сверка: расхождение' : ''}`;
  const bak = st.lastBackupAt ? `бэкап ${fmtDay(st.lastBackupAt)}` : 'бэкап не скачивался';
  // 7 плиток вместо 11 (D93): импорт и бэкап — «Данные»; вид, установка, редкое и продвинутое — «Настройки»
  return h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'tiles' },
      setupOpen ? tile('#/setup', 'Настройка', o.hasData ? `сделано ${p.done} из ${p.total}` : 'шаг 1 — загрузить бэкап', 'warn') : null,
      tile('#/help', 'Как пользоваться', 'что умеет приложение и когда его открывать'),
      tile('#/data', 'Данные', `${imp} · ${bak}`, reconcileBad ? 'bad' : backupAge === null || backupAge > 30 ? 'warn' : ''),
      tile('#/markup', 'Разметка', !o.hasData ? 'после импорта' : unclassified ? `не размечено: ${unclassified}` : 'всё размечено ✓', unclassified ? 'warn' : ''),
      tile('#/accounts', 'Счета', !o.hasData ? 'после импорта' : review && !review.done && !review.locked ? 'ждут ответа' : nWord(accounts, 'счёт', 'счёта', 'счетов'), review && !review.done && !review.locked ? 'warn' : ''),
      tile('#/incomes', 'Доходы', st.settings.incomeSchedule.length ? `доходов: ${st.settings.incomeSchedule.length}` : 'не заданы', st.settings.incomeSchedule.length ? '' : 'warn'),
      tile('#/debts', 'Долги и рассрочки', found ? `найдено в операциях: ${found}` : st.obligations.length ? `заведено: ${st.obligations.length}` : 'нет', found ? 'warn' : ''),
      tile('#/prefs', 'Настройки', `тема: ${theme}`),
    ),
    h('p', { class: 'foot-note' }, `Capital OS · версия ${APP_VERSION}`),
  );
}

/** «Данные»: импорт из MoneyManager и бэкап приложения — оба про файлы с данными. */
export function renderData(): HTMLElement {
  const st = getState();
  const o = ov();
  const reconcileBad = o.hasData && !o.reconcile?.ok;
  return h(
    'div',
    { class: 'screen' },
    rows(
      row({ title: 'Импорт из MoneyManager', sub: !o.hasData ? 'данных пока нет' : `последний ${fmtDay(st.importedAt ?? today())} · ${reconcileBad ? 'сверка: расхождение' : 'сверка ✓'}`, href: '#/import', mark: reconcileBad }),
      row({ title: 'Бэкап приложения', sub: st.lastBackupAt ? `последний ${fmtDay(st.lastBackupAt)}` : 'ещё не скачивался', href: '#/backup' }),
    ),
    h('p', { class: 'one-line' }, 'Импорт — свежие операции из MoneyManager. Бэкап — копия всего, что ты настроил здесь.'),
  );
}

/** «Настройки»: вид, установка (если ещё не установлено), редкое и для продвинутых. */
export function renderPrefs(): HTMLElement {
  const theme = { auto: 'как в телефоне', light: 'светлая', dark: 'тёмная' }[themePref()];
  return h(
    'div',
    { class: 'screen' },
    rows(
      row({ title: 'Вид', sub: `тема: ${theme}`, href: '#/view' }),
      isInstalled() ? null : row({ title: 'Установить как приложение', sub: 'значок на экране, работает без интернета', href: '#/install' }),
      row({ title: 'Редкое', sub: 'долги на начало учёта, ручные счета, поправки', href: '#/rare' }),
      row({ title: 'Для продвинутых', sub: 'правила разметки, параметры, сценарии', href: '#/advanced' }),
    ),
  );
}
