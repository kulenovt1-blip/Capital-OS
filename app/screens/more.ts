/** «Ещё» (D81): плитки 2×N со статусом — всё, что нужно не каждый день. */
import { h } from '../dom';
import { getState, today } from '../store';
import { ov, progress, steps } from '../ctx';
import { fmtDay, nWord } from '../ui';
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
  return h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'tiles' },
      setupOpen ? tile('#/setup', 'Настройка', o.hasData ? `сделано ${p.done} из ${p.total}` : 'шаг 1 — загрузить бэкап', 'warn') : null,
      tile('#/import', 'Импорт', !o.hasData ? 'данных нет' : `последний ${fmtDay(st.importedAt ?? today())} · ${reconcileBad ? 'сверка: расхождение' : 'сверка ✓'}`, !o.hasData ? 'warn' : reconcileBad ? 'bad' : ''),
      tile('#/markup', 'Разметка', !o.hasData ? 'после импорта' : unclassified ? `не размечено: ${unclassified}` : 'всё размечено ✓', unclassified ? 'warn' : ''),
      tile('#/accounts', 'Счета', !o.hasData ? 'после импорта' : review && !review.done && !review.locked ? `ждут ответа · ${nWord(accounts, 'счёт', 'счёта', 'счетов')}` : nWord(accounts, 'счёт', 'счёта', 'счетов'), review && !review.done && !review.locked ? 'warn' : ''),
      tile('#/incomes', 'Доходы', st.settings.incomeSchedule.length ? `доходов: ${st.settings.incomeSchedule.length}` : 'не заданы', st.settings.incomeSchedule.length ? '' : 'warn'),
      tile('#/debts', 'Долги и рассрочки', found ? `найдено в операциях: ${found}` : st.obligations.length ? `заведено: ${st.obligations.length}` : 'нет', found ? 'warn' : ''),
      tile('#/backup', 'Бэкап', st.lastBackupAt ? `последний ${fmtDay(st.lastBackupAt)}` : 'ещё не скачивался', backupAge === null || backupAge > 30 ? 'warn' : ''),
      tile('#/view', 'Вид', `тема: ${theme}`),
      tile('#/install', 'Установить', 'как приложение'),
      tile('#/rare', 'Редкое', 'долги на начало учёта, ручные счета, поправки'),
      tile('#/advanced', 'Для продвинутых', 'правила, параметры, сценарии'),
    ),
    h('p', { class: 'foot-note' }, `Capital OS · версия ${APP_VERSION}`),
  );
}
