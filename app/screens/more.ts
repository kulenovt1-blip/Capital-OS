/** «Ещё»: что ждёт внимания → главное действие → мои данные → приложение. */
import { h } from '../dom';
import { getState, today } from '../store';
import { ov, progress, steps } from '../ctx';
import { fmt, fmtDay, nWord, row, rows, sub, toggle } from '../ui';
import { act } from '../store';
import { isInstalled } from '../install';
import { fontPref, themePref } from '../theme';
import { daysBetween, essentialMarkupMissing } from '../../engine/index';
import { sheetHref } from '../main';

export const APP_VERSION = '0.5.0';
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
  const reconcileBad = o.hasData && !o.reconcile?.ok;
  const text = fontPref() === '1' ? 'крупный' : 'обычный';
  const imp = !o.hasData ? 'данных нет' : `импорт ${fmtDay(st.importedAt ?? today())}${reconcileBad ? ' · сверка: расхождение' : ''}`;
  const bak = st.lastBackupAt ? `бэкап ${fmtDay(st.lastBackupAt)}` : 'бэкап не скачивался';
  const noIncome = !st.settings.incomeSchedule.length;
  const markup = o.hasData && essentialMarkupMissing(o);
  // «Требует внимания» — только то, что реально ждёт; остальное разложено по назначению: действие, мои данные, приложение (аудит UX: семь одинаковых плиток)
  const attention = [
    setupOpen ? row({ title: 'Настройка', sub: o.hasData ? `сделано ${p.done} из ${p.total}` : 'шаг 1 — загрузить бэкап', href: '#/setup', cls: 'warn' }) : null,
    markup ? row({ title: 'Что обязательно?', sub: 'отметь траты «без этого не прожить» — иначе запас посчитан неточно', href: '#/markup', cls: 'warn' }) : null,
    reconcileBad ? row({ title: 'Сверка не сошлась', sub: 'цифры могут расходиться с MoneyManager', href: '#/data', cls: 'bad' }) : null,
    accountsWait ? row({ title: 'Счета ждут ответа', sub: 'нужно подтвердить, что считать деньгами', href: '#/accounts', cls: 'warn' }) : null,
    noIncome ? row({ title: 'Доходы не заданы', sub: 'без них прогноз неполный', href: '#/incomes', cls: 'warn' }) : null,
    found ? row({ title: 'Найдены долги и рассрочки', sub: `в операциях: ${found} — проверь и заведи`, href: '#/debts', cls: 'warn' }) : null,
    o.hasData && (backupAge === null || backupAge > 30) ? row({ title: 'Бэкап давно не скачивался', sub: st.lastBackupAt ? `последний ${fmtDay(st.lastBackupAt)}` : 'ещё ни разу', href: '#/backup', cls: 'warn' }) : null,
  ].filter(Boolean) as HTMLElement[];
  return h(
    'div',
    { class: 'screen' },
    attention.length ? h('div', { class: 'stack' }, sub('Требует внимания'), rows(...attention)) : null,
    h('a', { class: 'tile primary-tile', href: '#/income' }, h('span', { class: 'tt' }, 'Пришли деньги'), h('span', { class: 'ts' }, 'зарплата или стипендия: сколько отложить и на что')),
    h(
      'div',
      { class: 'stack' },
      sub('Мои данные'),
      rows(
        row({ title: 'Данные', sub: `${imp} · ${bak}`, href: '#/data' }),
        row({ title: 'Счета', sub: !o.hasData ? 'после импорта' : nWord(accounts, 'счёт', 'счёта', 'счетов'), href: '#/accounts' }),
        row({ title: 'Доходы', sub: noIncome ? 'не заданы' : `доходов: ${st.settings.incomeSchedule.length}`, href: '#/incomes' }),
        row({ title: 'Долги и рассрочки', sub: st.obligations.length ? `заведено: ${st.obligations.length}` : 'нет', href: '#/debts' }),
      ),
    ),
    h(
      'div',
      { class: 'stack' },
      sub('Приложение'),
      rows(row({ title: 'Настройки', sub: `текст: ${text}`, href: '#/prefs' }), row({ title: 'Как пользоваться', sub: 'что умеет приложение и когда его открывать', href: '#/help' })),
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
  const p = st.settings.position;
  return h(
    'div',
    { class: 'screen' },
    rows(
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
      row({ title: 'Редкое', sub: 'долги на начало учёта, ручные счета, поправки', href: '#/rare' }),
      row({ title: 'Для продвинутых', sub: 'правила разметки, параметры, сценарии', href: '#/advanced' }),
    ),
  );
}
