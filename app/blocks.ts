/**
 * Общие блоки для мастера настройки и подэкранов (D79, D84): вопрос о счетах «не учитывать»,
 * разметка категорий, быстрый доход, сбережения вне MoneyManager, долги до начала данных, первая подушка.
 */
import {
  ALL_CLASSES, CLASS_LABELS, INCOME_KIND_LABELS, accountsNeedingReview, categoryDisplayName, classRegistry, incomeKindRegistry, isAllowedClass, setCategoryClass,
  starterGoals, suggestClassForCategory, validateIncomeItem, type AppState, type Category, type IncomeKind, type IncomeScheduleItem, type OpClass, type ClassDef,
} from '../engine/index';
import { field, h } from './dom';
import { act, getState, today } from './store';
import { ov } from './ctx';
import { chip, errorsBox, fmt, moneyInput, newId, nWord, readMoney, readStr, row, rows, typeLabel } from './ui';
import { closeSheet, defineSheet, sheetHref } from './main';

// ───────────────────────── счета «не учитывать в балансе» ─────────────────────────

function setAccount(id: string, excluded: boolean): (s: AppState) => AppState {
  return (s) => {
    const rest = s.settings.accounts.filter((x) => x.accountId !== id);
    const prev = s.settings.accounts.find((x) => x.accountId === id);
    const next = { ...(prev ?? { accountId: id, liquidity: { kind: 'instant' as const } }), excluded, reviewed: true };
    return { ...s, settings: { ...s.settings, accounts: [...rest, next].sort((x, y) => (x.accountId < y.accountId ? -1 : 1)) } };
  };
}

/** На каждый счёт две большие кнопки (D58). Пустой список — «все отвечены». */
export function accountsReview(): HTMLElement {
  const st = getState();
  const review = st.imported ? accountsNeedingReview(st.settings.accounts, st.imported.accounts) : [];
  if (!review.length) return h('div', { class: 'okline' }, '✓ Все счета «не учитывать в балансе» разобраны');
  return h(
    'div',
    { class: 'stack' },
    h('p', { class: 'muted' }, 'В MoneyManager этот флаг ставят и на технические счета, и на заначки. Заначка — твои деньги: она входит в капитал.'),
    review.map((a) =>
      h(
        'div',
        { class: 'card stack' },
        h('strong', null, a.title),
        h('div', { class: 'choice' },
          h('button', { class: 'btn', type: 'button', onclick: () => act(setAccount(a.id, true), `«${a.title}» не учитывается`) }, 'Технический — не считать'),
          h('button', { class: 'btn', type: 'button', onclick: () => act(setAccount(a.id, false), `«${a.title}» учитывается как твои деньги`) }, 'Мои отложенные деньги — считать'),
        ),
      ),
    ),
  );
}

// ───────────────────────── разметка категорий ─────────────────────────

/** Одна строка пояснения у каждого встроенного типа. */
export const TYPE_HINTS: Record<string, string> = {
  E_base: 'без этого не прожить месяц: еда, связь, проезд',
  E_fun: 'кафе, развлечения, хобби',
  E_family: 'помощь семье',
  E_health: 'лекарства, врачи',
  E_edu: 'курсы, книги, учёба',
  E_installment_own: 'платёж по своей рассрочке или кредиту',
  E_installment_family: 'рассрочка, которую платишь за семью',
  E_other: 'всё остальное',
  I_work: 'зарплата, подработка',
  I_benefit: 'пособия и выплаты',
  I_stipend: 'стипендия',
  I_gift: 'подарили деньги',
  I_interest: 'проценты по вкладу',
  I_cashback: 'кэшбэк, бонусы',
  I_other: 'прочие доходы',
  F_lent: 'дал кому-то в долг',
  F_lent_back: 'тебе вернули долг',
  F_borrowed: 'занял у кого-то',
  F_borrowed_back: 'вернул долг',
  T_transfer: 'перевод между своими счетами',
  T_savings_out: 'отложил на счёт, которого нет в MoneyManager',
  T_savings_in: 'вернул деньги из сбережений вне MoneyManager',
  T_correction: 'поправка баланса, размен',
};

export interface CatRow {
  cat: Category;
  kind: 'income' | 'expense';
  count: number;
  total: number;
  current: OpClass | 'mixed' | 'UNCLASSIFIED';
  hint: OpClass | null;
}

/** Категории с операциями: текущий тип и подсказка. */
export function categoryRows(st: AppState = getState()): CatRow[] {
  const o = ov();
  if (!st.imported || !o.classification) return [];
  const seen = new Map<string, { count: number; total: number; classes: Set<OpClass>; kind: 'income' | 'expense'; categoryId: string }>();
  for (const c of o.classification.ops) {
    if (c.op.kind === 'transfer' || c.op.categoryId === null) continue;
    const key = `${c.op.categoryId}|${c.op.kind}`;
    const v = seen.get(key) ?? { count: 0, total: 0, classes: new Set<OpClass>(), kind: c.op.kind, categoryId: c.op.categoryId };
    v.count++;
    v.total += c.op.amount;
    v.classes.add(c.cls);
    seen.set(key, v);
  }
  const out: CatRow[] = [];
  for (const v of seen.values()) {
    const cat = st.imported.categories.find((c) => c.id === v.categoryId);
    if (!cat) continue;
    const current = v.classes.size === 1 ? [...v.classes][0]! : 'mixed';
    const name = catName(cat);
    out.push({ cat, kind: v.kind, count: v.count, total: v.total, current, hint: current === 'UNCLASSIFIED' ? suggestClassForCategory(name, v.kind) : null });
  }
  return out.sort((a, b) => Number(b.current === 'UNCLASSIFIED') - Number(a.current === 'UNCLASSIFIED') || catName(a.cat).localeCompare(catName(b.cat), 'ru'));
}

export function catName(c: Category): string {
  return getState().settings.categoryLabels[c.id] || categoryDisplayName(c.label);
}

const assign = (cat: Category, cls: OpClass, kind: 'income' | 'expense') => (s: AppState): AppState => ({ ...s, settings: { ...s.settings, classification: setCategoryClass(s.settings.classification, cat, cls, kind) } });

export type MarkupFilter = 'todo' | 'expense' | 'income' | 'all';
let filter: MarkupFilter | null = null;

/** Список разметки: фильтры-чипы, «Принять все подсказки», строки категорий (D84). */
export function markupList(rerender: () => void): HTMLElement {
  const st = getState();
  const reg = classRegistry(st.settings.classes);
  const all = categoryRows(st);
  if (!all.length) return h('p', { class: 'muted' }, 'Категорий пока нет — загрузи бэкап.');
  const todo = all.filter((r) => r.current === 'UNCLASSIFIED');
  const f: MarkupFilter = filter ?? (todo.length ? 'todo' : 'all');
  const list = all.filter((r) => (f === 'todo' ? r.current === 'UNCLASSIFIED' : f === 'all' ? true : r.kind === f));
  const hinted = todo.filter((r) => r.hint);
  const set = (v: MarkupFilter) => () => ((filter = v), rerender());
  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'chips', role: 'toolbar', 'aria-label': 'Фильтр' }, chip(`Не размечено (${todo.length})`, f === 'todo', set('todo')), chip('Траты', f === 'expense', set('expense')), chip('Доходы', f === 'income', set('income')), chip('Все', f === 'all', set('all'))),
    hinted.length
      ? h(
          'button',
          {
            class: 'btn primary wide',
            type: 'button',
            onclick: () =>
              act((s) => {
                let cls = s.settings.classification;
                for (const r of hinted) cls = setCategoryClass(cls, r.cat, r.hint!, r.kind);
                return { ...s, settings: { ...s.settings, classification: cls } };
              }, `Размечено по подсказкам: ${hinted.length}`),
          },
          `Принять все подсказки (${hinted.length})`,
        )
      : null,
    list.length
      ? rows(
          list.map((r) => {
            const name = catName(r.cat);
            const right =
              r.current === 'UNCLASSIFIED'
                ? r.hint
                  ? chip(`Похоже: ${typeLabel(r.hint, reg)}`, false, () => act(assign(r.cat, r.hint!, r.kind), `«${name}» → ${typeLabel(r.hint!, reg)}`), 'hint')
                  : null
                : h('span', { class: r.current === 'mixed' ? 'tag warn' : 'tag' }, r.current === 'mixed' ? 'смешано' : typeLabel(r.current, reg));
            return h(
              'div',
              { class: `row tall${r.current === 'UNCLASSIFIED' ? '' : ''}` },
              h('a', { class: 'main', href: sheetHref('type', `${r.cat.id}|${r.kind}`), style: 'text-decoration:none;color:inherit;min-height:44px;display:flex;flex-direction:column;justify-content:center' },
                h('div', { class: 'title' }, name),
                h('div', { class: 'rsub' }, `${r.kind === 'income' ? 'доход' : 'трата'} · ${nWord(r.count, 'операция', 'операции', 'операций')} · ${fmt(r.total as never)}`),
              ),
              right ? h('div', { class: 'val' }, right) : null,
              r.current === 'UNCLASSIFIED' && !r.hint ? h('a', { class: 'chip', href: sheetHref('type', `${r.cat.id}|${r.kind}`) }, 'Выбрать ›') : null,
            );
          }),
        )
      : h('div', { class: 'okline' }, f === 'todo' ? '✓ Всё размечено' : 'Здесь пусто'),
  );
}

/** Выбор типа: сгруппировано «Траты / Доходы / Долги / Переводы», у каждого — строка пояснения. */
defineSheet('type', (arg) => {
  const [catId, kind] = arg.split('|') as [string, 'income' | 'expense'];
  const st = getState();
  const cat = st.imported?.categories.find((c) => c.id === catId);
  if (!cat || (kind !== 'income' && kind !== 'expense')) return null;
  const reg = classRegistry(st.settings.classes);
  const current = categoryRows(st).find((r) => r.cat.id === catId && r.kind === kind)?.current;
  const allowed = (c: OpClass) => c !== 'UNCLASSIFIED' && isAllowedClass(kind, c);
  const builtin = ALL_CLASSES.filter(allowed);
  const own: ClassDef[] = reg.filter((c) => !c.builtin && allowed(c.id));
  const pick = (c: OpClass) => () => {
    void act(assign(cat, c, kind), `«${catName(cat)}» → ${typeLabel(c, reg)}`);
    closeSheet();
  };
  const item = (c: OpClass, hint: string) => row({ title: typeLabel(c, reg), sub: hint, onClick: pick(c), cls: c === current ? 'on' : '', value: c === current ? '✓' : undefined });
  const group = (title: string, items: HTMLElement[]) => (items.length ? [h('h3', { class: 'sub' }, title), rows(items)] : []);
  return {
    title: catName(cat),
    body: h(
      'div',
      null,
      ...group('Свои типы', own.map((c) => item(c.id, c.label))),
      ...group(kind === 'income' ? 'Доходы' : 'Траты', builtin.filter((c) => c.startsWith(kind === 'income' ? 'I_' : 'E_')).map((c) => item(c, TYPE_HINTS[c] ?? ''))),
      ...group('Долги', builtin.filter((c) => c.startsWith('F_')).map((c) => item(c, TYPE_HINTS[c] ?? ''))),
      ...group('Переводы', builtin.filter((c) => c.startsWith('T_')).map((c) => item(c, TYPE_HINTS[c] ?? ''))),
    ),
  };
});

// ───────────────────────── доход: три поля ─────────────────────────

/** «Откуда · Какого числа · Сколько в месяц»; вид по умолчанию «зависит от работы», меняется ссылкой. */
export function incomeQuickForm(onDone?: () => void): HTMLElement {
  const reg = incomeKindRegistry(getState().settings.incomeKinds);
  const kind = h('select', { name: 'kind', 'aria-label': 'Вид дохода' }, reg.map((k) => h('option', { value: k.id }, k.label)));
  const kindBox = h('div', { hidden: true }, field('Вид дохода', kind, 'от вида зависит, как доход поведёт себя в плохом сценарии'), field('Закончится (необязательно)', h('input', { name: 'end', type: 'date' })));
  const err = h('div');
  const form = h(
    'form',
    { class: 'stack' },
    field('Откуда', h('input', { name: 'title', placeholder: 'Зарплата', required: true, autocomplete: 'off' })),
    h('div', { class: 'grid-form' }, field('Какого числа', h('input', { name: 'day', type: 'number', min: 1, max: 31, inputmode: 'numeric', placeholder: '5' })), field('Сколько в месяц, ₸', moneyInput('amount'))),
    h('button', { class: 'btn link', type: 'button', onclick: (e: Event) => ((kindBox.hidden = false), (e.currentTarget as HTMLElement).remove()) }, `Вид: ${INCOME_KIND_LABELS.work} · другой вид`),
    kindBox,
    h('button', { class: 'btn primary wide', type: 'submit' }, 'Добавить доход'),
    err,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = readMoney(form, 'amount');
    const day = Math.floor(Number(readStr(form, 'day')));
    const errs: string[] = [];
    if (!readStr(form, 'title')) errs.push('Напиши, откуда доход');
    if (!(day >= 1 && day <= 31)) errs.push('Число месяца — от 1 до 31');
    if (amount === null || amount <= 0) errs.push('Сумма должна быть больше нуля');
    const end = readStr(form, 'end');
    const item: IncomeScheduleItem = { id: newId('inc'), title: readStr(form, 'title'), dayOfMonth: day, amount: amount ?? (0 as never), kind: (readStr(form, 'kind') || 'work') as IncomeKind, ...(end ? { end } : {}) };
    if (!errs.length) errs.push(...validateIncomeItem(item, reg));
    err.replaceChildren(errorsBox(errs) ?? '');
    if (errs.length) return;
    await act((s) => ({ ...s, settings: { ...s.settings, incomeSchedule: [...s.settings.incomeSchedule, item] } }), `Доход «${item.title}» добавлен`);
    onDone?.();
  });
  return form;
}

export function incomeList(): HTMLElement | null {
  const st = getState();
  const reg = incomeKindRegistry(st.settings.incomeKinds);
  if (!st.settings.incomeSchedule.length) return null;
  return rows(
    st.settings.incomeSchedule.map((x) =>
      row({ title: x.title, sub: `${x.dayOfMonth}-го · ${reg.find((k) => k.id === (x.kind ?? 'stable'))?.label ?? ''}${x.end ? ` · до ${x.end.slice(8, 10)}.${x.end.slice(5, 7)}.${x.end.slice(0, 4)}` : ''}`, value: fmt(x.amount), href: '#/incomes' }),
    ),
  );
}

// ───────────────────────── сбережения вне MoneyManager ─────────────────────────

export function savingsQuestion(): HTMLElement {
  const st = getState();
  const sf = st.settings.savingsFlows;
  const est = ov().capital.accounts.find((p) => p.source === 'savings_flow');
  const choose = (mode: 'estimate' | 'ignore', label: string) => () =>
    act((s) => ({ ...s, settings: { ...s.settings, savingsFlows: { mode, confirmed: true } } }), label);
  const on = (m: string) => (sf.confirmed && sf.mode === m ? ' on' : '');
  return h(
    'div',
    { class: 'stack' },
    h('p', null, `Часть расходов размечена как перевод на сбережения вне MoneyManager${est ? ` — всего ${fmt(est.balance)}` : ''}. Где эти деньги сейчас?`),
    h(
      'div',
      { class: 'choice' },
      h('button', { class: `btn${on('estimate')}`, type: 'button', onclick: choose('estimate', 'Сбережения считаются по сумме переводов') }, 'Лежат на счёте, которого нет в MoneyManager — считать по сумме переводов'),
      h('button', { class: `btn${on('ignore')}`, type: 'button', onclick: choose('ignore', 'Сбережения уже в балансах счетов') }, 'Вернулись в MoneyManager (например, счётом с начальным остатком) — не считать второй раз'),
      h('a', { class: 'btn', href: '#/accounts/savings' }, 'Прибавлять к ручному счёту ›'),
    ),
  );
}

// ───────────────────────── долги до начала данных ─────────────────────────

export function debtsQuestion(): HTMLElement {
  const st = getState();
  const neg = ov().capital.explanation.filter((x) => x.code === 'capital.payables_negative' || x.code === 'capital.receivables_negative');
  const ack = st.settings.openingDebts.acknowledged;
  return h(
    'div',
    { class: 'stack' },
    h('p', null, 'В данных есть возврат долга, а самого долга нет: он возник до первой операции в бэкапе.'),
    neg.length ? h('ul', { class: 'plain muted' }, neg.map((x) => h('li', null, x.text.split('.')[0] + '.'))) : null,
    ack
      ? h('div', { class: 'okline' }, '✓ Принято: сумма неизвестна, считается 0')
      : h('button', { class: 'btn primary wide', type: 'button', onclick: () => act((s) => ({ ...s, settings: { ...s.settings, openingDebts: { ...s.settings.openingDebts, acknowledged: true } } }), 'Принято: сумма неизвестна, считается 0') }, 'Не знаю — считать 0'),
    h('a', { class: 'btn', href: '#/rare/debts' }, 'Я знаю суммы ›'),
  );
}

// ───────────────────────── первая цель: подушка ─────────────────────────

/** Сумма подушки по правилу: N месяцев обычных базовых трат. */
export function cushionAmount(): number {
  return ov().baseline.median * getState().settings.reserveMonths;
}

export function cushionOffer(): HTMLElement | null {
  const st = getState();
  if (st.goals.some((g) => g.role === 'safety' && g.status !== 'cancelled')) return null;
  const amount = cushionAmount();
  const months = st.settings.reserveMonths;
  return h(
    'div',
    { class: 'card stack' },
    h('strong', null, `Нет подушки — создать на ${months} мес.${amount > 0 ? `, ${fmt(amount as never)}` : ''}?`),
    h('p', { class: 'muted' }, amount > 0 ? 'Сумма посчитана по твоим обычным базовым тратам и будет пересчитываться сама.' : 'Сумма посчитается сама, когда будут размечены базовые траты.'),
    h(
      'button',
      {
        class: 'btn primary wide',
        type: 'button',
        onclick: () =>
          act((s) => {
            const g = starterGoals(today())[0]!;
            const id = s.goals.some((x) => x.id === g.id) ? newId('goal') : g.id;
            return { ...s, goals: [...s.goals, { ...g, id, title: 'Подушка' }] };
          }, 'Подушка создана'),
      },
      'Создать подушку',
    ),
  );
}

export { CLASS_LABELS, nWord };
