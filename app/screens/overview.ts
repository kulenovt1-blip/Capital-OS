/** Экран «Обзор»: капитал, ликвидность, ближайшие обязательства, свободные деньги, уведомления. */
import { add, buildOverview, ZERO, type Overview } from '../../engine/index';
import { h, section, table } from '../dom';
import { getState, today } from '../store';
import { setupBanner } from './setup';
import { explainBlock, fmt, fmtDate, info, liquidityText, moneySpan, notices, stat } from '../ui';
import type { Child } from '../dom';
const lab = (t: string, k: Parameters<typeof info>[0]): Child => h('span', null, t, info(k));

export type OverviewBuilder = () => Overview;

/** По умолчанию — обзор этапа 1; этап 2 подставляет версию с целями. */
export let overviewBuilder: OverviewBuilder = () => buildOverview(getState(), today());
export function setOverviewBuilder(b: OverviewBuilder): void {
  overviewBuilder = b;
}

export function renderOverview(): HTMLElement {
  const o = overviewBuilder();
  const c = o.capital;
  const root = h('div', { class: 'screen' });
  root.append(
    h('p', { class: 'muted date-line' }, `На ${fmtDate(o.today)}${o.classification && !o.classification.complete ? ' · отчёт неполный' : ''}`),
    setupBanner() ?? '',
    notices(o.notices) ?? '',
    h(
      'div',
      { class: 'stats' },
      // первым — сколько денег на руках; капитал нетто следом, с расшифровкой (D71)
      stat(lab('Ликвидно сейчас', 'liquid'), moneySpan(c.liquidNow), 'деньги, которые можно снять сегодня', 'accent'),
      stat(lab('Свободно', 'free'), moneySpan(o.freeMoney), `до дохода ${fmtDate(o.nextIncome.date)}${o.nextIncome.source === 'default' ? ' (условно)' : ''}`, o.freeMoney < 0 ? 'bad' : ''),
      stat(lab('Капитал нетто', 'net'), moneySpan(c.net), c.liabilities.total ? `на счетах ${fmt(c.gross)} − долги и рассрочки ${fmt(c.liabilities.total)}` : 'долгов и рассрочек нет'),
      c.liabilities.total ? stat(lab('Обязательства', 'liabilities'), moneySpan(c.liabilities.total), liabilityParts(c)) : '',
      c.receivables ? stat(lab('Тебе должны', 'receivables'), moneySpan(c.receivables), 'в нетто не входит') : '',
      o.reserveUntilIncome ? stat(lab('Резерв до дохода', 'reserveUntilIncome'), moneySpan(o.reserveUntilIncome), 'платежи по обязательствам') : '',
    ),
    explainBlock([...c.explanation.filter((s) => s.level !== 'warn'), ...o.explanation]) ?? '',
  );

  const total30 = o.upcoming30.reduce((a, u) => add(a, u.amount), ZERO);
  root.append(
    folded(
      'upcoming',
      o.upcoming30.length ? `Платежи на 30 дней: ${o.upcoming30.length} на ${fmt(total30)}` : 'Платежей на 30 дней нет',
      o.upcoming30.length
        ? table(
            ['Дата', 'Обязательство', 'Сумма'],
            o.upcoming30.map((u) => [fmtDate(u.date), `${u.title}${u.owner === 'family' ? ' (семья)' : ''}`, moneySpan(u.amount)]),
          )
        : h('p', { class: 'muted' }, 'Рассрочки и долги добавляются в «Настройки → Обязательства»; найденные в операциях рассрочки там предложатся сами.'),
    ),
  );

  const shown = c.accounts.filter((p) => !p.excluded);
  const excluded = c.accounts.filter((p) => p.excluded);
  root.append(
    section(
      'Счета',
      table(
        ['Счёт', 'Баланс', 'Доступ', ''],
        shown.map((p) => [
          p.title,
          moneySpan(p.balance),
          liquidityText(p.liquidity),
          p.source === 'manual' ? h('span', { class: 'badge' }, 'вручную') : p.source === 'savings_flow' ? h('span', null, h('span', { class: 'badge warn' }, 'оценка'), info('savingsFlow')) : '',
        ]),
      ),
      excluded.length
        ? h(
            'details',
            { class: 'add', 'data-key': 'overview:excluded' },
            h('summary', null, `Исключённые (${excluded.length}) — в капитал не входят`),
            table(
              ['Счёт', 'Баланс'],
              excluded.map((p) => [p.title, moneySpan(p.balance, { muted: true })]),
            ),
            h('p', { class: 'muted' }, h('a', { href: '#/settings/accounts' }, 'Изменить в «Настройки → Счета»')),
          )
        : null,
    ),
  );

  if (o.obligations.length) {
    const left = o.obligations.filter((s) => s.obligation.kind !== 'recurring').reduce((a, s) => add(a, s.remainingNow), ZERO);
    root.append(
      folded(
        'obligations',
        `Обязательства: ${o.obligations.length}${left ? `, осталось выплатить ${fmt(left)}` : ''}`,
        table(
          ['Название', 'Остаток', 'Следующий платёж'],
          o.obligations.map((s) => [
            `${s.obligation.title}${s.obligation.owner === 'family' ? ' (семья)' : ''}`,
            s.obligation.kind === 'recurring' ? 'регулярный' : moneySpan(s.remainingNow),
            s.nextDue ? `${fmt(s.nextDue.amount)} · ${fmtDate(s.nextDue.date)}` : '—',
          ]),
        ),
      ),
    );
  }
  return root;
}

/** Свёрнутый раздел: заголовок-итог видно всегда, таблица — по нажатию. */
function folded(key: string, summary: string, body: HTMLElement): HTMLElement {
  return h('section', { class: 'card folded' }, h('details', { 'data-key': `overview:${key}` }, h('summary', null, h('h2', null, summary)), body));
}

function liabilityParts(c: Overview['capital']): string {
  const l = c.liabilities;
  const parts: [string, number][] = [['свои рассрочки', l.installmentsOwn], ['семейные', l.installmentsFamily], ['долги', add(l.debtsManual, l.payablesFromOps)]];
  return parts.filter(([, v]) => v !== 0).map(([t, v]) => `${t} ${fmt(v as never)}`).join(' · ');
}
