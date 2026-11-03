/**
 * «Обзор» (D82, заменяет D71): одно главное число — сколько свободно до дохода; под ним разбивка,
 * капитал и долги мелко, одна карточка «Требует внимания», платежи строкой, счета списком.
 */
import { addDays, type Overview } from '../../engine/index';
import { h } from '../dom';
import { today } from '../store';
import { badAccounts, ov, progress } from '../ctx';
import { attentionItems } from '../attention';
import { attention, fmt, fmtDay, hero, info, nWord, row, rows, sub, whenAvailable } from '../ui';
import { registerExplain } from '../explain';
import { defineSheet, refresh, sheetHref } from '../main';
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
 * «Как посчитано» для главного числа (D93): одна цепочка сверху вниз — из чего сложилось «Свободно»,
 * с расшифровкой каждого слагаемого. Остальные числа «Обзора» — ниже, свёрнуто.
 */
function freeChain(o: Overview): HTMLElement {
  const c = o.capital;
  const till = o.nextIncome.source === 'schedule' ? `до ${fmtDay(o.nextIncome.date)}` : `на ${fmtDay(o.nextIncome.date)} (30 дней)`;
  const onHand = c.accounts.filter((p) => !p.excluded && p.availableFrom <= today() && p.balance !== 0);
  const goalTitle = new Map(o.goals.map((g) => [g.id, g.title]));
  const liquid = new Set(onHand.map((p) => p.accountId));
  const byGoal = new Map<string, number>();
  for (const f of o.fundings) if (liquid.has(f.accountId)) byGoal.set(f.goalId, (byGoal.get(f.goalId) ?? 0) + f.amount);
  const goalsList = [...byGoal.entries()].filter(([, v]) => v > 0);
  const line = (sign: string, title: string, value: number, detail: string | null) =>
    row({ title: h('span', null, h('span', { class: 'chain-sign' }, sign), title), sub: detail ?? undefined, value: fmt(value as never) });
  const others = [...c.explanation.filter((s) => s.level !== 'warn' && !s.detail), ...o.explanation.filter((s) => !s.detail && s.code !== 'overview.free' && s.code !== 'overview.reserve')];
  return h(
    'div',
    { class: 'stack' },
    hero(`Свободно ${till}`, fmt(o.freeMoney), 'столько можно тратить или отложить, ничего не задев', { neg: o.freeMoney < 0 }),
    sub('Из чего сложилось'),
    rows(
      line('', 'Деньги на счетах', c.liquidNow, onHand.map((p) => `${p.title} ${fmt(p.balance)}`).join(' · ') || null),
      line('− ', 'Закреплено за целями', o.assigned, goalsList.map(([g, v]) => `${goalTitle.get(g) ?? 'цель'} ${fmt(v as never)}`).join(' · ') || null),
      line('− ', `Платежи по долгам ${till}`, o.reserveUntilIncome, o.untilIncome.map((u) => `${u.title} ${fmt(u.amount)} · ${fmtDay(u.date)}`).join(' · ') || 'платежей нет'),
      row({ title: h('strong', null, '= Свободно'), value: h('strong', null, fmt(o.freeMoney)) }),
    ),
    h('p', { class: 'muted' }, 'Траты на жизнь до дохода сюда не вычитаются — их учитывает экран «Доход», когда делит пришедшие деньги.'),
    others.length
      ? h('details', { class: 'fold', 'data-key': 'explain:overview-other' }, h('summary', null, 'Другие числа «Обзора»'), h('ul', { class: 'explain-list' }, others.map((s) => h('li', null, s.text))))
      : null,
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
    firstTimeHint(),
    heroBlock(o),
    h('div', { class: 'cells' }, cells),
    items.length ? attention(items, p.done < p.total ? p : undefined) : null,
    // список раскрывается на месте, без отдельной страницы (D93)
    o.upcoming30.length
      ? h(
          'details',
          { class: 'rows acc', 'data-key': 'overview:payments' },
          h(
            'summary',
            { class: 'row' },
            h('div', { class: 'main' }, h('div', { class: 'title' }, 'Платежи на 30 дней'), h('div', { class: 'rsub' }, `${nWord(o.upcoming30.length, 'платёж', 'платежа', 'платежей')} до ${fmtDay(end)}`)),
            h('div', { class: 'val' }, fmt(total30 as never)),
            h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
          ),
          o.upcoming30.map((u) => row({ title: `${u.title}${u.owner === 'family' ? ' (семья)' : ''}`, sub: fmtDay(u.date), value: fmt(u.amount), cls: 'sub-row' })),
        )
      : rows(row({ title: `Платежей до ${fmtDay(end)} нет` })),
    sub('Счета'),
    rows(
      shown.map((x) =>
        row({
          title: h('span', null, x.title, x.source === 'savings_flow' ? h('span', null, ' ', h('span', { class: 'tag warn' }, 'оценка')) : null),
          // «когда можно снять» — только если не сразу (D93): у обычной карты эта подпись ничего не говорит
          sub: whenAvailable(x.liquidity) || undefined,
          value: fmt(x.balance),
          mark: bad.has(x.accountId),
        }),
      ),
      excluded.length ? row({ title: `Не учитываются (${excluded.length})`, sub: 'в капитал не входят', href: sheetHref('excluded') }) : null,
    ),
  );
}
