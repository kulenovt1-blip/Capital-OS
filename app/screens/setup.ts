/**
 * Мастер «Настроим за 5 минут» (D79, заменяет экран «Первые шаги» D63): только нужные по данным шаги,
 * в порядке engine/setup.ts; точки прогресса сверху, «Пропустить» и «Дальше» внизу.
 * Счётчик честный: без данных — только «Шаг 1 — загрузить бэкап», без «из N».
 */
import type { SetupStep } from '../../engine/index';
import { h, toast } from '../dom';
import { getState } from '../store';
import { ov, progress, steps } from '../ctx';
import { stickyBar } from '../ui';
import { go } from '../main';
import { accountsReview, cushionOffer, debtsQuestion, incomeList, incomeQuickForm, markupList, savingsQuestion } from '../blocks';
import { suggestionsBlock } from './settings';

/** Совместимость: «готово ли всё обязательное». */
export function setupDone(): boolean {
  const p = progress();
  return p.done === p.total;
}

const HEADS: Record<SetupStep['id'], string> = {
  import: 'Загрузи бэкап MoneyManager',
  accounts: 'Что это за счета?',
  classes: 'Разметь категории',
  income: 'Когда приходят деньги?',
  savings: 'Где сбережения вне MoneyManager?',
  debts: 'Долги на начало учёта',
  obligations: 'Рассрочки из операций',
  goals: 'Первая цель',
  backup: 'Бэкап',
};

function body(s: SetupStep, rerender: () => void): HTMLElement {
  const o = ov();
  switch (s.id) {
    case 'import':
      return !o.hasData
        ? h('div', { class: 'stack' }, h('p', null, 'В MoneyManager: «Настройки → Резервная копия» → сохранить файл .mmbackup. Потом загрузи его здесь — файл читается на устройстве и никуда не отправляется.'), h('a', { class: 'btn primary big wide', href: '#/import' }, 'Загрузить бэкап'))
        : o.reconcile?.ok
          ? h('div', { class: 'okline' }, '✓ Бэкап загружен, все счета сходятся')
          : h('div', { class: 'stack' }, h('div', { class: 'badline' }, 'Загружен с расхождением: по некоторым счетам сумма операций не совпала с балансом MoneyManager.'), h('a', { class: 'btn', href: '#/import' }, 'Посмотреть ›'));
    case 'accounts':
      return accountsReview();
    case 'classes':
      return markupList(rerender);
    case 'income':
      // после добавления дохода — сразу следующий шаг: на одно нажатие меньше
      return h('div', { class: 'stack' }, incomeList(), incomeQuickForm(() => {
        const l = steps().filter((x) => !x.optional && x.id !== 'backup');
        const n = l[l.findIndex((x) => x.id === 'income') + 1];
        if (n) go(`#/setup/${n.id}`);
      }));
    case 'savings':
      return savingsQuestion();
    case 'debts':
      return debtsQuestion();
    case 'obligations':
      return suggestionsBlock(getState(), o) ?? h('div', { class: 'okline' }, '✓ Незаведённых рассрочек нет');
    case 'goals':
      return h('div', { class: 'stack' }, cushionOffer() ?? h('div', { class: 'okline' }, '✓ Подушка есть'), h('a', { class: 'btn wide', href: '#/goals' }, 'Создать свою цель ›'));
    default:
      return h('div');
  }
}

export function renderSetup(rerender: () => void, section?: string): HTMLElement {
  const o = ov();
  const all = steps().filter((s) => !s.optional && s.id !== 'backup');
  const list = o.hasData ? all : all.filter((s) => s.id === 'import');
  const cur = list.find((s) => s.id === section) ?? list.find((s) => !s.done) ?? list[list.length - 1]!;
  const i = list.indexOf(cur);
  const next = list[i + 1];
  const p = progress();
  const finish = () => {
    toast('Готово. Вот твой Обзор');
    go('#/overview');
  };
  return h(
    'div',
    { class: 'screen wizard' },
    o.hasData
      ? h('div', { class: 'dots', 'aria-label': `Шаг ${i + 1} из ${list.length}` }, list.map((s) => h('span', { class: s === cur ? 'on' : s.done ? 'done' : '' })))
      : null,
    h('p', { class: 'one-line' }, o.hasData ? `Шаг ${i + 1} из ${list.length} · сделано ${p.done} из ${p.total}` : 'Шаг 1 — загрузить бэкап'),
    h('h2', null, HEADS[cur.id]),
    cur.done && cur.id !== 'import' ? h('div', { class: 'okline' }, `✓ ${cur.status}`) : null,
    body(cur, rerender),
    o.hasData
      ? stickyBar(
          cur.done ? h('span', null, h('b', null, 'Готово'), next ? `дальше: ${HEADS[next.id].toLowerCase()}` : 'это последний шаг') : h('a', { class: 'btn link', href: next ? `#/setup/${next.id}` : '#/overview' }, 'Пропустить'),
          next ? h('a', { class: 'btn primary', href: `#/setup/${next.id}` }, 'Дальше') : h('button', { class: 'btn primary', type: 'button', onclick: finish }, 'Готово'),
        )
      : null,
  );
}
