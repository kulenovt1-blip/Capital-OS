/**
 * «Обзор» (D82, заменяет D71): одно главное число — сколько свободно до дохода; под ним разбивка,
 * капитал и долги мелко, одна карточка «Требует внимания», платежи строкой, счета списком.
 */
import { addDays, type Overview } from '../../engine/index';
import { h } from '../dom';
import { today } from '../store';
import { badAccounts, ov, progress } from '../ctx';
import { attentionItems } from '../attention';
import { attention, fmt, fmtDay, hero, info, liquidityText, nWord, row, rows, sub } from '../ui';
import { registerExplain } from '../explain';
import { defineSheet, sheetHref } from '../main';

registerExplain('overview', 'Как посчитано: «Обзор»', () => {
  const o = ov();
  return [...o.capital.explanation.filter((s) => s.level !== 'warn'), ...o.explanation];
});

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

function heroBlock(o: Overview): HTMLElement {
  const c = o.capital;
  const est = c.accounts.find((p) => p.source === 'savings_flow' && !p.excluded && p.availableFrom <= today());
  const label = o.nextIncome.source === 'schedule' ? h('span', null, `Свободно до ${fmtDay(o.nextIncome.date)}`, info('free')) : h('span', null, 'Свободно · горизонт 30 дней', info('free'));
  const parts = [`на руках ${fmt(c.liquidNow)}`, `за целями ${fmt(o.assigned)}`, `под платежи ${fmt(o.reserveUntilIncome)}`];
  const subline =
    o.freeMoney < 0
      ? h('span', null, `до дохода не хватает ${fmt((-o.freeMoney) as never)}`)
      : h('span', null, parts.join(' · '), est ? h('span', null, ` · в т. ч. оценка ${fmt(est.balance)}`, info('savingsFlow')) : null);
  return hero(label, fmt(o.freeMoney), subline, { neg: o.freeMoney < 0, extra: h('a', { class: 'link', href: sheetHref('explain', 'overview') }, 'Как посчитано ›') });
}

function emptyState(): HTMLElement {
  return h(
    'div',
    { class: 'screen' },
    hero('Свободно', '—', 'Загрузи бэкап MoneyManager — и здесь появится, сколько денег можно тратить до следующего дохода.'),
    h('a', { class: 'btn primary big wide', href: '#/import' }, 'Загрузить бэкап'),
    h('p', { class: 'one-line' }, 'Данные остаются на этом устройстве.'),
  );
}

export function renderOverview(): HTMLElement {
  const o = ov();
  if (!o.hasData) return emptyState();
  const c = o.capital;
  const bad = badAccounts();
  const p = progress();
  const items = attentionItems();
  const end = addDays(today(), 30);
  const total30 = o.upcoming30.reduce((s, u) => s + u.amount, 0);
  const shown = c.accounts.filter((x) => !x.excluded);
  const excluded = c.accounts.filter((x) => x.excluded);
  const cells = [
    h('a', { class: 'cell', href: sheetHref('explain', 'overview') }, h('div', { class: 'k' }, 'Капитал', info('net')), h('div', { class: 'v' }, fmt(c.net))),
    c.liabilities.total ? h('a', { class: 'cell', href: '#/debts' }, h('div', { class: 'k' }, 'Долги', info('liabilities')), h('div', { class: 'v' }, fmt(c.liabilities.total))) : null,
    c.receivables ? h('div', { class: 'cell' }, h('div', { class: 'k' }, 'Тебе должны', info('receivables')), h('div', { class: 'v' }, fmt(c.receivables))) : null,
  ];
  return h(
    'div',
    { class: 'screen' },
    heroBlock(o),
    h('div', { class: 'cells' }, cells),
    items.length ? attention(items, p.done < p.total ? p : undefined) : null,
    o.upcoming30.length
      ? rows(row({ title: 'Платежи на 30 дней', sub: `${nWord(o.upcoming30.length, 'платёж', 'платежа', 'платежей')} до ${fmtDay(end)}`, value: fmt(total30 as never), href: sheetHref('payments') }))
      : rows(row({ title: `Платежей до ${fmtDay(end)} нет` })),
    sub('Счета'),
    rows(
      shown.map((x) =>
        row({
          title: h('span', null, x.title, x.source === 'savings_flow' ? h('span', null, ' ', h('span', { class: 'tag warn' }, 'оценка')) : null),
          sub: `снять: ${liquidityText(x.liquidity)}`,
          value: fmt(x.balance),
          mark: bad.has(x.accountId),
        }),
      ),
      excluded.length ? row({ title: `Не учитываются (${excluded.length})`, sub: 'в капитал не входят', href: sheetHref('excluded') }) : null,
    ),
  );
}
