/**
 * «Обзор» (D96): главное число — сколько можно тратить до следующих денег и ≈ в день; рядом — сколько всего на руках
 * и сколько из них в копилках. Подушка одной строкой, платежи, «Требует внимания»; капитал и счета — в «Подробнее».
 */
import { addDays, cushionStatus, mulDiv, type Money, detectNewIncomes, flattenTree, lockedByDate, type Overview } from '../../engine/index';
import { h } from '../dom';
import { act, getState, today } from '../store';
import { badAccounts, ov, progress } from '../ctx';
import { attentionItems } from '../attention';
import { attention, fmt, fmtDay, hero, info, newId, nWord, row, rows, sub, whenAvailable } from '../ui';
import { registerExplain } from '../explain';
import { defineSheet, go, refresh, sheetHref } from '../main';
import { helpSeen, markHelpSeen } from './help';

registerExplain(
  'overview',
  'Как посчитано',
  () => {
    const o = ov();
    return [...o.capital.explanation.filter((s) => s.level !== 'warn'), ...o.explanation];
  },
  () => freeChain(ov()),
);

/**
 * «Как посчитано» для главного числа (D96, D100): только строки «название — сумма», без сплошного текста.
 * Слагаемые раскрываются вложенными строками (каждый счёт, каждая цель, каждый платёж).
 */
function freeChain(o: Overview): HTMLElement {
  const sp = o.spend;
  const till = `до ${fmtDay(o.nextIncome.date)}`;
  const spendAcc = o.capital.accounts.filter((p) => !p.excluded && sp.kinds[p.accountId] === 'spend' && p.availableFrom <= today() && p.balance !== 0);
  const goalTitle = new Map(o.goals.map((g) => [g.id, g.title]));
  const byGoal = new Map<string, number>();
  for (const f of o.fundings) if (sp.kinds[f.accountId] === 'spend') byGoal.set(f.goalId, (byGoal.get(f.goalId) ?? 0) + f.amount);
  const goalsList = [...byGoal.entries()].filter(([, v]) => v > 0);
  const head = (sign: string, title: string, value: number) => row({ title: h('strong', null, h('span', { class: 'chain-sign' }, sign), title), value: h('strong', null, fmt(value as never)) });
  const part = (title: string, value: number, subText?: string) => row({ title, value: fmt(value as never), cls: 'sub-row', ...(subText ? { sub: subText } : {}) });
  return h(
    'div',
    { class: 'stack' },
    hero(`Можно тратить ${till}`, fmt(sp.canSpend), `≈ ${fmt(sp.perDay)} в день · ${nWord(sp.days, 'день', 'дня', 'дней')} до дохода`, { neg: sp.canSpend < 0 }),
    rows(
      head('', 'На счетах для трат', sp.spendNow),
      spendAcc.map((p) => part(p.title, p.balance)),
      head('− ', 'Отложено, но не переведено', sp.setAsideOnSpend),
      goalsList.map(([g, v]) => part(goalTitle.get(g) ?? 'цель', v)),
      head('− ', `Платежи по долгам ${till}`, o.reserveUntilIncome),
      o.untilIncome.map((u) => part(u.title, u.amount, fmtDay(u.date))),
      head('= ', 'Можно тратить', sp.canSpend),
    ),
    sub('Для сравнения'),
    rows(
      row({ title: 'В день до дохода', sub: `${fmt(sp.canSpend)} ÷ ${nWord(sp.days, 'день', 'дня', 'дней')}`, value: fmt(sp.perDay) }),
      row({ title: 'Обычно уходит в день', sub: 'повседневное и регулярное, обычный месяц ÷ 30', value: fmt(sp.usualPerDay) }),
      sp.uncheckedMonthly > 0 ? row({ title: 'Из них не проверено', sub: 'категории, которые приложение не узнало, — по среднему за месяц', value: fmt(mulDivDay(sp.uncheckedMonthly)), href: '#/baskets' }) : null,
      row({ title: 'В копилках', sub: 'не входят — их не тратишь', value: fmt(sp.inSavings) }),
    ),
  );
}

defineSheet('payments', () => {
  const o = ov();
  return {
    title: 'Платежи на 30 дней',
    body: o.upcoming30.length
      ? rows(o.upcoming30.map((u) => row({ title: `${u.title}${u.owner === 'family' ? ' (семья)' : ''}`, sub: fmtDay(u.date), value: fmt(u.amount) })))
      : h('p', { class: 'muted' }, 'Платежей нет.'),
  };
});

defineSheet('excluded', () => {
  const o = ov();
  return {
    title: 'Не учитываются',
    body: h(
      'div',
      { class: 'stack' },
      rows(o.capital.accounts.filter((p) => p.excluded).map((p) => row({ title: p.title, value: h('span', { class: 'muted' }, fmt(p.balance)) }))),
      h('a', { class: 'btn', href: '#/accounts' }, 'Изменить в «Счета»'),
    ),
  };
});

export type OverviewBuilder = () => Overview;
/** Совместимость: раньше этап 2 подменял построитель обзора. */
export function setOverviewBuilder(_b: OverviewBuilder): void {}

/** Месячная сумма → в день (как «обычно уходит»: × 12 ÷ 365). */
const mulDivDay = (m: Money): Money => mulDiv(m, 12, 365);

function heroBlock(o: Overview): HTMLElement {
  const sp = o.spend;
  const label = o.nextIncome.source === 'schedule' ? h('span', null, `Можно тратить до ${fmtDay(o.nextIncome.date)}`, info('free')) : h('span', null, 'Можно тратить · на 30 дней', info('free'));
  const enough = sp.usualPerDay > 0 ? (sp.perDay >= sp.usualPerDay ? ' — хватает' : ' — меньше обычного') : '';
  const subline =
    sp.canSpend < 0
      ? h('span', null, `до дохода не хватает ${fmt((-sp.canSpend) as never)}`)
      : h(
          'span',
          null,
          `≈ ${fmt(sp.perDay)} в день`,
          sp.usualPerDay > 0 ? ` · обычно уходит ${fmt(sp.usualPerDay)}${enough}` : '',
          // часть «обычно уходит» — по категориям, которые приложение не узнало (D104)
          sp.uncheckedMonthly > 0 ? h('span', null, ' · ', h('a', { href: '#/baskets', style: 'color:inherit' }, `не проверено ${fmt(mulDivDay(sp.uncheckedMonthly))} в день ›`)) : null,
        );
  return hero(label, fmt(sp.canSpend), subline, { neg: sp.canSpend < 0, extra: h('a', { class: 'link', href: sheetHref('explain', 'overview') }, 'Как посчитано ›') });
}

/** Подушка — одной строкой: готова или сколько осталось (D96). */
function cushionRow(o: Overview): HTMLElement | null {
  const n = flattenTree(o.goalTree).find((x) => x.goal.role === 'safety' && x.goal.parentId === undefined && x.goal.status === 'active');
  const status = cushionStatus(n);
  if (!n || status === 'none') return rows(row({ title: 'Подушки нет', sub: 'запас на случай, если доход пропадёт', href: '#/goals~cushion' }));
  // сумму не посчитать — так и сказать, а не «0 ₸ из 0 ₸» (D103)
  if (status === 'unknown') return rows(row({ title: 'Размер подушки пока не посчитать', sub: 'не хватает данных о тратах — проверь раскладку трат или задай сумму сам', href: '#/goals~cushion', cls: 'warn' }));
  const ready = status === 'ready';
  return rows(
    row({
      title: ready ? 'Подушка готова' : `Подушка: осталось ${fmt(n.remainingMin)}`,
      sub: `${fmt(n.progress)} из ${fmt(n.goal.targetMin)}`,
      value: ready ? h('span', { class: 'good' }, '✓') : undefined,
      href: '#/goals',
    }),
  );
}

/** Новый доход в бэкапе — одной строкой: добавить или «это не доход» (D96). */
function newIncomeLine(): HTMLElement | null {
  const st = getState();
  const c = detectNewIncomes(st, today(), ov())[0];
  if (!c) return null;
  const add = () =>
    act(
      (s) => ({ ...s, settings: { ...s.settings, incomeSchedule: [...s.settings.incomeSchedule, { id: newId('inc'), title: c.title, dayOfMonth: c.dayOfMonth, amount: c.amount, kind: 'stable' }] } }),
      `Доход «${c.title}» добавлен`,
    );
  // нерегулярный: в прогнозе — по среднему, в «Хуже» — 0 (D66)
  const addIrregular = () =>
    act(
      (s) => ({ ...s, settings: { ...s.settings, incomeSchedule: [...s.settings.incomeSchedule, { id: newId('inc'), title: c.title, dayOfMonth: c.dayOfMonth, amount: c.amount, kind: 'irregular' }] } }),
      `«${c.title}» добавлен как нерегулярный доход`,
    );
  const no = () => act((s) => ({ ...s, settings: { ...s.settings, dismissedIncomes: [...(s.settings.dismissedIncomes ?? []), c.categoryId] } }), 'Больше не спрошу');
  return h(
    'div',
    { class: 'hint-card stack' },
    h('div', null, h('strong', null, 'Похоже на регулярный доход: '), `«${c.title}» ≈ ${fmt(c.amount)}, около ${c.dayOfMonth}-го — было в ${c.months} из 3 последних месяцев. Это так?`),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn primary', type: 'button', onclick: add }, 'Да, каждый месяц'),
      h('button', { class: 'btn', type: 'button', onclick: addIrregular }, 'Бывает по-разному'),
      h('button', { class: 'btn', type: 'button', onclick: no }, 'Это не доход'),
    ),
    h('p', { class: 'muted' }, 'Сумму и число можно поправить потом в «Ещё → Доходы».'),
  );
}

function emptyState(): HTMLElement {
  return h(
    'div',
    { class: 'screen' },
    hero('Свободно', '—', 'Загрузи бэкап MoneyManager — и здесь появится, сколько денег можно тратить до следующего дохода.'),
    h('a', { class: 'btn primary big wide', href: '#/import' }, 'Загрузить бэкап'),
    h('p', { class: 'one-line' }, 'Данные остаются на этом устройстве.'),
    h('a', { class: 'btn wide', href: '#/help' }, 'Что умеет приложение'),
  );
}

/** «Впервые здесь?» — пока человек не открывал справку и не закрыл подсказку (D94). */
function firstTimeHint(): HTMLElement | null {
  if (helpSeen()) return null;
  return h(
    'div',
    { class: 'hint-card' },
    h('a', { href: '#/help' }, h('strong', null, 'Впервые здесь?'), h('span', null, ' Коротко: что умеет приложение и когда его открывать ›')),
    h('button', { class: 'close', type: 'button', 'aria-label': 'Скрыть подсказку', onclick: () => (markHelpSeen(), refresh()) }, '×'),
  );
}

export function renderOverview(): HTMLElement {
  const o = ov();
  if (!o.hasData) return emptyState();
  if (!getState().settings.firstRunDone) {
    queueMicrotask(() => go('#/start'));
  }
  const c = o.capital;
  const sp = o.spend;
  const bad = badAccounts();
  const p = progress();
  const items = attentionItems();
  const till = addDays(today(), 30);
  const total30 = o.upcoming30.reduce((s, u) => s + u.amount, 0);
  const shown = c.accounts.filter((x) => !x.excluded);
  const excluded = c.accounts.filter((x) => x.excluded);
  // по каждой дате — своя сумма (D103): «320 000 с 05.12» вместо «20 000 с 05.12 и 300 000 с 01.02» вводило в заблуждение
  const groups = lockedByDate(sp.locked);
  const lockedLine = groups.length
    ? groups.length === 1
      ? `из них ${fmt(groups[0]!.amount)} снять можно с ${fmtDay(groups[0]!.date)}`
      : `пока не снять: ${groups.slice(0, 2).map((g) => `${fmt(g.amount)} до ${fmtDay(g.date)}`).join(', ')}${groups.length > 2 ? ` и ещё ${groups.length - 2}` : ''}`
    : null;
  const details = h(
    'details',
    { class: 'fold', 'data-key': 'overview:details', open: getState().settings.showDetails ? true : undefined },
    h('summary', null, 'Подробнее: капитал, долги, все счета'),
    h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'cells' },
        h('a', { class: 'cell', href: sheetHref('explain', 'overview') }, h('div', { class: 'k' }, 'Капитал', info('net')), h('div', { class: 'v' }, fmt(c.net))),
        c.liabilities.total ? h('a', { class: 'cell', href: '#/debts' }, h('div', { class: 'k' }, 'Долги', info('liabilities')), h('div', { class: 'v' }, fmt(c.liabilities.total))) : null,
      ),
      sub('Счета'),
      rows(
        shown.map((x) =>
          row({
            title: h('span', null, x.title, x.source === 'savings_flow' ? h('span', null, ' ', h('span', { class: 'tag warn' }, 'оценка')) : null),
            sub: [sp.kinds[x.accountId] === 'savings' ? 'копилка' : 'для трат', whenAvailable(x.liquidity)].filter(Boolean).join(' · '),
            value: fmt(x.balance),
            mark: bad.has(x.accountId),
          }),
        ),
        excluded.length ? row({ title: `Не учитываются (${excluded.length})`, sub: 'в капитал не входят', href: sheetHref('excluded') }) : null,
      ),
    ),
  );
  return h(
    'div',
    { class: 'screen' },
    firstTimeHint(),
    heroBlock(o),
    h(
      'div',
      { class: 'cells' },
      h('a', { class: 'cell', href: '#/accounts' }, h('div', { class: 'k' }, 'Всего на счетах'), h('div', { class: 'v' }, fmt(sp.onHand)), lockedLine ? h('div', { class: 'cs' }, lockedLine) : null),
      h('a', { class: 'cell', href: '#/goals' }, h('div', { class: 'k' }, 'Из них в копилках'), h('div', { class: 'v' }, fmt(sp.inSavings))),
    ),
    newIncomeLine(),
    cushionRow(o),
    o.upcoming30.length
      ? h(
          'details',
          { class: 'rows acc', 'data-key': 'overview:payments' },
          h(
            'summary',
            { class: 'row' },
            h('div', { class: 'main' }, h('div', { class: 'title' }, 'Платежи на 30 дней'), h('div', { class: 'rsub' }, `${nWord(o.upcoming30.length, 'платёж', 'платежа', 'платежей')} до ${fmtDay(till)}`)),
            h('div', { class: 'val' }, fmt(total30 as never)),
            h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
          ),
          o.upcoming30.map((u) => row({ title: `${u.title}${u.owner === 'family' ? ' (семья)' : ''}`, sub: fmtDay(u.date), value: fmt(u.amount), cls: 'sub-row' })),
        )
      : null,
    items.length ? attention(items, p.done < p.total ? p : undefined) : null,
    details,
  );
}
