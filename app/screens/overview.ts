/**
 * «Обзор» (D96): главное число — сколько можно тратить до следующих денег и ≈ в день; рядом — сколько всего на руках
 * и сколько из них в копилках. Подушка одной строкой, платежи, «Требует внимания»; капитал и счета — в «Подробнее».
 */
import { monthlyCard } from './monthly';
import { addDays, arrivedIncomes, buildSimInput, expensePart, cushionStatus, spendGap, mulDiv, type Money, detectNewIncomes, flattenTree, lockedByDate, dataFreshness, type Overview } from '../../engine/index';
import { h } from '../dom';
import { loadDemo } from './import';
import { act, getState, today } from '../store';
import { badAccounts, ov, progress, reserveCtx } from '../ctx';
import { attentionItems } from '../attention';
import { attention, fmt, fmtDay, fmtShort, hero, info, monthGen, monthTo, newId, nWord, row, rows, sub, whenAvailable } from '../ui';
import { registerExplain } from '../explain';
import { defineSheet, go, refresh, sheetHref } from '../main';
import { helpSeen, markHelpSeen } from './help';
import { isSimpleMode } from '../../engine/index';
import { simpleHint } from '../modehint';
import { openCapabilities } from '../whatsnew';

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
  // знак — рядом с суммой, а не с названием (замечание владельца)
  const head = (sign: string, title: string, value: number) => row({ title: h('strong', null, title), value: h('strong', null, `${sign}${fmt(value as never)}`) });
  const part = (title: string, value: number, subText?: string) => row({ title, value: fmt(value as never), cls: 'sub-row', ...(subText ? { sub: subText } : {}) });
  return h(
    'div',
    { class: 'stack' },
    hero(`Свободно после обычных трат ${till}`, fmt(sp.canSpend), `≈ ${fmt(sp.perDay)} в день сверх обычного · ${nWord(sp.days, 'день', 'дня', 'дней')} до дохода`, { neg: sp.canSpend < 0 }),
    rows(
      head('', 'На счетах для трат', sp.spendNow),
      spendAcc.map((p) => part(p.title, p.balance)),
      head('−', 'Отложено на цели — перевода ещё нет в бэкапе', sp.setAsideOnSpend),
      goalsList.map(([g, v]) => part(goalTitle.get(g) ?? 'цель', v)),
      head('−', `Платежи по долгам ${till}`, o.reserveUntilIncome),
      o.untilIncome.map((u) => part(u.title, u.amount, fmtDay(u.date))),
      head('−', `Обычные траты ${till}`, sp.usualUntilIncome),
      head('= ', 'Свободно после обычных трат', sp.canSpend),
    ),
    sub('Для сравнения'),
    rows(
      row({ title: 'Сверх обычного в день', sub: `${fmt(sp.canSpend)} ÷ ${nWord(sp.days, 'день', 'дня', 'дней')} — сверх того, что и так уходит`, value: fmt(sp.perDay) }),
      row({ title: 'Обычно уходит в день', sub: 'повседневное и регулярное, обычный месяц ÷ 30', value: fmt(sp.usualPerDay) }),
      sp.uncheckedMonthly > 0 ? row({ title: 'Из них не проверено', sub: 'категории, которые приложение не узнало, — по среднему за месяц', value: fmt(mulDivDay(sp.uncheckedMonthly)), href: '#/baskets' }) : null,
      row({ title: 'В копилках', sub: 'не входят — их не тратишь', value: fmt(sp.inSavings) }),
    ),
    rareLine(),
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
/** Совместимость: раньше вторая стадия разработки подменяла построитель обзора. */
export function setOverviewBuilder(_b: OverviewBuilder): void {}

/** Месячная сумма → в день (как «обычно уходит»: × 12 ÷ 365). */
const mulDivDay = (m: Money): Money => mulDiv(m, 12, 365);

/**
 * Редкие траты (подарки, одежда…) — отдельной строкой, теми же числами, что в прогнозе (D109).
 * В «≈ в день» их не смешиваем: за неделю до дохода они почти никогда не случаются, а в среднем «съели» бы большую часть.
 */
function rareLine(): HTMLElement | null {
  const st = getState();
  if (!st.imported) return null;
  // редкие — те же, что в прогнозе: за год / 12 и крупные сверх обычного месяца (D109, D119)
  const rare = buildSimInput(st, today()).input.expenses.filter((e) => expensePart(st, e.key) === 'rare');
  const total = rare.reduce((a, e) => a + e.monthly, 0) as Money;
  if (total <= 0) return null;
  const names = [...rare].sort((a, b) => b.monthly - a.monthly).slice(0, 2).map((e) => e.title.split(' (')[0]!.toLowerCase());
  return h('a', { href: sheetHref('explain', 'forecast'), style: 'color:inherit;display:block' }, `+ редкие траты ≈ ${fmt(total)} в месяц (${names.join(', ')}${rare.length > 2 ? '…' : ''}) ›`);
}

/** Карточка «Пришли деньги» (аудит UX): вкладки «Доход» больше нет — вопрос возникает на «Обзоре» ровно тогда, когда в бэкапе появился новый приход. */
function arrivedCard(): HTMLElement | null {
  const st = getState();
  const found = arrivedIncomes(st, today(), ov());
  if (!found.length) return null;
  const x = found[0]!;
  return rows(row({ title: `Пришло ${fmtShort(x.amount)}: ${x.title}`, sub: `${fmtDay(x.date)} · распределить на цели и жизнь?${found.length > 1 ? ` Ещё ${found.length - 1}` : ''}`, href: '#/income', cls: 'warn' }));
}

function heroBlock(o: Overview): HTMLElement {
  const sp = o.spend;
  // К4 аудита UX: при нехватке «Можно тратить −1,96 млн» звучит абсурдно и пугает без выхода — говорим прямо и даём шаг
  if (sp.canSpend < 0) {
    const till = o.nextIncome.source === 'schedule' ? `до ${fmtDay(o.nextIncome.date)}` : 'на 30 дней';
    const gap = spendGap(sp);
    // деньги в копилках есть — прямо говорим, что делать (D182), а не только «не хватает»
    if (gap?.covered) {
      return hero(h('span', null, `Перевести с копилки ${till}`, info('free')), fmtShort(gap.gap), h('span', null, `на счетах для трат не хватает на платежи и обычные траты; в копилках лежит ${fmtShort(gap.savings)}`), {
        extra: h('div', { class: 'stack tight' }, h('a', { class: 'link', href: sheetHref('explain', 'overview') }, 'Как посчитано ›')),
      });
    }
    return hero(h('span', null, `Не хватает ${till}`, info('free')), fmtShort((-sp.canSpend) as never), h('span', null, 'чтобы дожить до дохода: платежи и обычные траты'), {
      extra: h('div', { class: 'stack tight' }, h('a', { class: 'link', href: '#/forecast~save-where' }, 'Что можно сделать ›'), h('a', { class: 'link', href: sheetHref('explain', 'overview') }, 'Как посчитано ›')),
    });
  }
  const label = o.nextIncome.source === 'schedule' ? h('span', null, `Свободно после обычных трат до ${fmtDay(o.nextIncome.date)}`, info('free')) : h('span', null, 'Свободно после обычных трат · 30 дней', info('free'));
  // С8: рядом с «≈ 29 тыс в день» — сколько обычно уходит, чтобы лимит не читался как разрешение тратить всё
  const usual = sp.usualPerDay > 0 ? ` · обычно уходит ~${fmtShort(sp.usualPerDay)}` : '';
  const subline = h('span', null, `≈ ${fmtShort(sp.perDay)} в день сверх обычного${usual}`);
  return hero(label, fmtShort(sp.canSpend), subline, { extra: h('a', { class: 'link', href: sheetHref('explain', 'overview') }, 'Как посчитано ›') });
}

/** Истории меньше 3 полных месяцев — числа приблизительные (шаг 4 аудита, D105). */
function historyNote(o: Overview): HTMLElement | null {
  const n = o.baseline.months.length;
  // меньше месяцев, чем просил человек в настройках, — значит, данных мало (а не настройка «считать по 2 мес.»)
  if (n >= 3 || n >= getState().settings.baselineMonths) return null;
  const have = n === 0 ? 'Полных месяцев в данных ещё нет' : `В данных ${nWord(n, 'полный месяц', 'полных месяца', 'полных месяцев')}`;
  return h('div', { class: 'warnline' }, `${have} — «обычно уходит», подушка и прогноз пока приблизительные. С 3 месяцами истории станут точнее.`);
}

/** Данные из MoneyManager давно не обновлялись — числа «сейчас» могут не совпадать с реальностью (D180). */
function freshnessNote(): HTMLElement | null {
  const st = getState();
  const f = dataFreshness(st.importedAt, today());
  if (f.level === 'none' || f.level === 'fresh') return null;
  const ago = nWord(f.days!, 'день', 'дня', 'дней');
  return h('a', { class: 'warnline', href: '#/import', style: 'display:block;color:inherit' }, f.level === 'stale'
    ? `Данные из MoneyManager старые: загружены ${fmtDay(st.importedAt!)}, ${ago} назад. Свободные деньги и подсказки могут быть неверны — загрузи свежий бэкап ›`
    : `Данные загружены ${fmtDay(st.importedAt!)}, ${ago} назад. Если с тех пор были траты, загрузи свежий бэкап ›`);
}

/** Подушка — одной строкой: готова или сколько осталось (D96). */
function cushionRow(o: Overview): HTMLElement | null {
  const n = flattenTree(o.goalTree).find((x) => x.goal.role === 'safety' && x.goal.parentId === undefined && x.goal.status === 'active');
  const status = cushionStatus(n);
  // К4 (D157): строка говорит о цели, а не о деньгах — «Подушки нет» при запасе на полгода была неправдой; при запасе ≥ 3 мес. цель не навязывается
  if (!n || status === 'none') return (reserveCtx()?.coverMonths ?? 0) >= 3 ? null : rows(row({ title: 'Цель «Подушка» не создана', sub: 'запас на случай, если доход пропадёт', href: '#/goals~cushion' }));
  // сумму не посчитать — так и сказать, а не «0 ₸ из 0 ₸» (D103)
  if (status === 'unknown') return rows(row({ title: 'Размер подушки пока не посчитать', sub: 'нет записей о тратах за последние месяцы — задай сумму сам или загрузи свежий бэкап', href: '#/goals~cushion', cls: 'warn' }));
  const ready = status === 'ready';
  // К6 аудита UX: деньги есть, но не закреплены за подушкой — одна понятная строка с действием, без формулы (она — на карточке цели)
  const notPinned = !ready && o.spend.onHand >= n.goal.targetMin;
  // ответ «так задумано» (с листа «Перенести в подушку» или с «Прогноза») — не напоминать об этом снова
  if (notPinned && (getState().settings.sanityAnswered ?? []).includes('cushion_ignores_money')) return null;
  return rows(
    row({
      title: ready ? 'Подушка готова' : notPinned ? 'Подушка: деньги есть, но не закреплены' : `Подушка: осталось ${fmtShort(n.remainingMin)}`,
      sub: notPinned ? `Закрепить ${fmtShort(n.remainingMin)}` : `${fmtShort(n.progress)} из ${fmtShort(n.goal.targetMin)}`,
      value: ready ? h('span', { class: 'good' }, '✓') : undefined,
      href: notPinned ? '#/goals~cushion-fill' : '#/goals',
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
  // С1 аудита UX: две равные кнопки и подсказка, где взять файл, — до первого числа не нужно ничего знать про приложение
  return h(
    'div',
    { class: 'screen' },
    hero('Можно тратить', '—', 'Загрузи бэкап MoneyManager — и здесь появится, сколько денег можно тратить до следующего дохода.'),
    h('a', { class: 'btn primary big wide', href: '#/import' }, 'Загрузить бэкап'),
    h('button', { class: 'btn big wide', type: 'button', onclick: () => void loadDemo() }, 'Посмотреть на примере'),
    h('p', { class: 'one-line' }, 'Данные остаются на этом устройстве. Пример — выдуманный студент: можно посмотреть, как всё выглядит.'),
    isSimpleMode(getState().settings) ? h('p', { class: 'one-line' }, 'Показано только главное. Полный режим — в «Ещё → Настройки».') : null,
    h(
      'details',
      { class: 'fold', 'data-key': 'overview:backup-help' },
      h('summary', null, 'Где взять бэкап'),
      h(
        'div',
        { class: 'stack' },
        h('p', null, 'В MoneyManager: «Настройки → Резервная копия» → сохрани файл .mmbackup. Потом выбери его здесь — файл читается на устройстве и никуда не отправляется.'),
        h('p', { class: 'muted' }, 'Начал вести бюджет недавно — это нормально. Приложение оценит по тому, что есть, и честно покажет, насколько расчёты пока приблизительные.'),
      ),
    ),
    h('button', { class: 'btn wide', type: 'button', onclick: () => openCapabilities() }, 'Что умеет приложение'),
  );
}

/** Первый запуск после импорта: число уже видно, а вопросы — одной карточкой (С1 аудита UX). */
function firstRunCard(): HTMLElement | null {
  if (getState().settings.firstRunDone) return null;
  return h('a', { class: 'hint-card first-run', href: '#/start' }, h('strong', null, 'Число предварительное. '), h('span', null, 'Ответь на 3 коротких вопроса — доходы, счета, цели — и оно станет точнее. Минута ›'));
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

/** Всё, что ждёт ответа, — одной сворачиваемой строкой «Нужно решение · N» (этап 2): вопросы не вклиниваются в экран. */
function decisionRow(items: ReturnType<typeof attentionItems>, progressNow?: { done: number; total: number }): HTMLElement | null {
  const income = newIncomeLine();
  const n = items.length + (income ? 1 : 0);
  if (!n) return null;
  return h(
    'details',
    { class: 'fold', 'data-key': 'overview:decisions' },
    h('summary', null, `Нужно решение · ${n}`),
    h('div', { class: 'stack' }, income, attention(items, progressNow)),
  );
}

export function renderOverview(): HTMLElement {
  const o = ov();
  if (!o.hasData) return emptyState();
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
  const simple = isSimpleMode(getState().settings);
  // платежи на 30 дней: в полном режиме отдельной строкой, в простом — внутри «Подробнее» (D186)
  const paymentsRow = o.upcoming30.length
    ? h(
        'details',
        { class: 'rows acc', 'data-key': 'overview:payments' },
        h(
          'summary',
          { class: 'row' },
          h('div', { class: 'main' }, h('div', { class: 'title' }, 'Платежи на 30 дней'), h('div', { class: 'rsub' }, nWord(o.upcoming30.length, 'платёж', 'платежа', 'платежей'))),
          h('div', { class: 'val' }, fmtShort(total30 as never)),
          h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
        ),
        o.upcoming30.map((u) => row({ title: `${u.title}${u.owner === 'family' ? ' (семья)' : ''}`, sub: fmtDay(u.date), value: fmt(u.amount), cls: 'sub-row' })),
      )
    : null;
  const details = h(
    'details',
    { class: 'fold', 'data-key': 'overview:details', open: getState().settings.showDetails ? true : undefined },
    h('summary', null, simple ? 'Подробнее: платежи, капитал, счета' : 'Подробнее: капитал, долги, все счета'),
    h(
      'div',
      { class: 'stack' },
      simple ? paymentsRow : null,
      simple && lockedLine ? h('p', { class: 'muted' }, `Всего на счетах: ${lockedLine}`) : null,
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
  // этап 2: пять блоков — главное число, счета, ступень с запасом, платежи, «Нужно решение»; остальное — в «Подробнее» и в «Как посчитано»
  const decisions = decisionRow(items, p.done < p.total ? p : undefined);
  return h(
    'div',
    { class: 'screen' },
    firstTimeHint(),
    heroBlock(o),
    firstRunCard(),
    arrivedCard(),
    monthlyCard(),
    freshnessNote(),
    historyNote(o),
    h(
      'div',
      { class: 'cells' },
      h('a', { class: 'cell', href: '#/accounts' }, h('div', { class: 'k' }, 'Всего на счетах'), h('div', { class: 'v' }, fmtShort(sp.onHand)), !simple && lockedLine ? h('div', { class: 'cs' }, lockedLine) : null),
      h('a', { class: 'cell', href: '#/goals' }, h('div', { class: 'k' }, 'Из них в копилках'), h('div', { class: 'v' }, fmtShort(sp.inSavings))),
    ),
    cushionRow(o),
    simple ? null : paymentsRow,
    decisions,
    details,
    simpleHint('платежи, капитал и счета — в «Подробнее»'),
  );
}
