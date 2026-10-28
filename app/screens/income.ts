/** Экран «Новое поступление»: сумма → шаг 0 → таблица стратегий → выбор → метки на деньгах. */
import {
  acceptAllocation, buildGoalsView, eligibleGoals, isReserve, planIncome, formatMonthRu,
  type CompareResult, type CustomStrategy, type Money, type StrategyParams, type StrategyRow,
} from '../../engine/index';
import { field, h, section, toast } from '../dom';
import { getState, today, update } from '../store';
import { errorsBox, explainBlock, fmt, info, moneyInput, moneySpan, newId, readChecked, readMoney, readStr } from '../ui';

let last: { result: CompareResult; accountId: string; amount: Money } | null = null;

function tenths(v: number | null): string {
  return v === null ? '—' : `${(v / 10).toFixed(1).replace('.', ',')} мес.`;
}

function rowCard(row: StrategyRow, r: CompareResult, accountId: string, rerender: () => void): HTMLElement {
  const st = getState();
  const title = (id: string) => st.goals.find((g) => g.id === id)?.title ?? id;
  const note = h('input', { placeholder: 'заметка к решению (необязательно)' });
  const err = h('div');
  return h(
    'div',
    { class: 'card strategy' },
    h('h2', null, `${row.ids.join(' = ')} · ${row.label}`),
    h('p', { class: 'price' }, row.price, info('price')),
    h(
      'table',
      { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'Цель'), h('th', null, 'Сейчас'), h('th', null, 'Дата'), h('th', null, 'Сдвиг', info('shift')))),
      h(
        'tbody',
        null,
        Object.keys({ ...row.goalDates, ...row.byGoal }).sort().map((g) =>
          h(
            'tr',
            null,
            h('td', { 'data-label': '' }, title(g)),
            h('td', { 'data-label': 'Сейчас' }, row.byGoal[g] ? moneySpan(row.byGoal[g]!) : '—'),
            h('td', { 'data-label': 'Дата' }, row.goalDates[g] ? formatMonthRu(row.goalDates[g]!) : 'за горизонтом'),
            h('td', { 'data-label': 'Сдвиг' }, row.shiftVsPlan[g] ? `${row.shiftVsPlan[g]! > 0 ? '+' : ''}${row.shiftVsPlan[g]} мес.` : '0'),
          ),
        ),
      ),
    ),
    h(
      'p',
      { class: 'muted' },
      `Свободно: ${fmt(row.free)} · резерв ${tenths(row.reserveMonthsTenths)} · капитал через 6/12/24 мес.: ${[6, 12, 24].map((k) => (row.capitalAfter[k] === null ? '—' : fmt(row.capitalAfter[k]!))).join(' / ')}`,
    ),
    row.underfunded.length ? h('div', { class: 'notice warn' }, `Недофинансировано: ${row.underfunded.map((u) => `«${title(u.goalId)}» ${fmt(u.given)} из ${fmt(u.required)}`).join(', ')}`) : null,
    row.violations.length ? h('details', { class: 'explain' }, h('summary', null, `Нарушения в прогнозе (${row.violations.length})`), h('ul', null, row.violations.map((v) => h('li', { class: 'warn' }, v)))) : null,
    explainBlock(row.explanation, 'Как распределено'),
    h(
      'div',
      { class: 'row' },
      note,
      h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          onclick: async () => {
            const res = acceptAllocation(getState(), r, row, accountId, today(), newId('dec'), note.value.trim());
            if (!res.ok) return err.replaceChildren(errorsBox([res.error]) ?? '');
            last = null;
            await update(() => res.value);
            toast(`Выбрано: ${row.label}. Метки поставлены, переводы не делались`);
            rerender();
          },
        },
        'Выбрать этот вариант',
      ),
    ),
    err,
  );
}

export function renderIncome(rerender: () => void): HTMLElement {
  const st = getState();
  const v = buildGoalsView(st, today());
  const goals = eligibleGoals(v.goals).list.filter((g) => !isReserve(g));
  const root = h('div', { class: 'screen' });
  if (!st.imported) {
    root.append(h('div', { class: 'notice info' }, 'Сначала импортируй бэкап MoneyManager — без него неизвестны балансы и расходы.'));
    return root;
  }
  const liquid = v.accounts.filter((a) => a.liquidNow);
  const form = h(
    'form',
    { class: 'grid-form' },
    field('Сумма поступления, ₸', moneyInput('amount', last?.amount)),
    field('Куда пришли деньги', h('select', { name: 'acc' }, liquid.map((a) => h('option', { value: a.accountId, selected: a.accountId === last?.accountId }, `${a.title} — свободно ${fmt(a.free)}`)))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'inBalance', checked: true }), ' уже есть в импортированном балансе', info('incomeInBalance')),
    field('Стратегия C ускоряет', h('select', { name: 'focus' }, h('option', { value: '' }, 'самую важную цель'), goals.map((g) => h('option', { value: g.id }, g.title)))),
    h(
      'details',
      { class: 'add', 'data-key': 'income:custom' },
      h('summary', null, 'Своя стратегия D (необязательно)'),
      h(
        'div',
        { class: 'grid-form' },
        field('Резерв довести до, ₸', moneyInput('d-reserve'), 'не ниже минимума резерва'),
        ...goals.flatMap((g) => [field(`«${g.title}»: минимум, ₸`, moneyInput(`d-min-${g.id}`, undefined, '')), field(`«${g.title}»: % остатка`, h('input', { name: `d-pct-${g.id}`, inputmode: 'decimal', class: 'short' }))]),
      ),
    ),
    h('button', { class: 'btn primary', type: 'submit' }, 'Рассчитать варианты'),
  );
  const err = h('div');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = readMoney(form, 'amount');
    if (amount === null || amount <= 0) return err.replaceChildren(errorsBox(['Введи сумму поступления']) ?? '');
    const focus = readStr(form, 'focus');
    const strategies: StrategyParams[] = [{ id: 'A' }, { id: 'B' }, { id: 'C', ...(focus ? { focusGoalIds: [focus] } : {}) }];
    const dRes = readStr(form, 'd-reserve');
    if (dRes) {
      const custom: CustomStrategy = { reserveTarget: readMoney(form, 'd-reserve') ?? (0 as Money), minimums: [], rest: [] };
      for (const g of goals) {
        const m = readStr(form, `d-min-${g.id}`) ? readMoney(form, `d-min-${g.id}`) : null;
        if (m) custom.minimums.push({ goalId: g.id, amount: m });
        const p = Number(readStr(form, `d-pct-${g.id}`).replace(',', '.'));
        if (p > 0) custom.rest.push({ goalId: g.id, pctBp: Math.round(p * 100) });
      }
      strategies.push({ id: 'D', custom });
    }
    const result = planIncome(getState(), today(), { amount, incomeInBalance: readChecked(form, 'inBalance'), strategies });
    last = { result, accountId: readStr(form, 'acc'), amount };
    err.replaceChildren();
    rerender();
  });
  root.append(
    section(h('span', null, 'Новое поступление', info('strategies')), h('p', { class: 'muted' }, 'Система считает, сколько можно распределить после обязательств и расходов до следующего дохода, и сравнивает стратегии. Деньги никуда не переводятся: выбор ставит метки на целях.'), form, err),
  );

  if (last) {
    const r = last.result;
    root.append(
      section(
        h('span', null, r.step0.ok ? `Доступно к распределению: ${fmt(r.step0.available)}` : `Дефицит: ${fmt(r.step0.deficit)}`, info('step0')),
        h('ul', { class: 'plain' }, r.step0.explanation.map((s) => h('li', { class: s.level ?? 'info' }, s.text))),
        r.step0.options.length ? h('div', { class: 'notice error' }, h('strong', null, 'Варианты:'), h('ul', null, r.step0.options.map((o) => h('li', null, o)))) : null,
        r.merged.map((m) => h('div', { class: 'notice info' }, m.reason)),
        r.explanation.filter((s) => s.code === 'compare.d_invalid').map((s) => h('div', { class: 'notice warn' }, s.text)),
      ),
    );
    for (const row of r.rows) root.append(rowCard(row, r, last.accountId, rerender));
    if (r.rows[0]) root.append(h('details', { class: 'explain' }, h('summary', null, 'Предположения прогноза'), h('ul', null, r.rows[0].assumptions.map((a) => h('li', null, a)))));
  }
  return root;
}

