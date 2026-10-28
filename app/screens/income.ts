/**
 * Экран «Доход» (D86): «Сколько пришло → на какой счёт → сравнить варианты» и карточки вариантов.
 * Шаг 0 (R1, R2) и формулы — только в «Как посчитано»; на экране — «Можно распределить X».
 */
import {
  acceptAllocation, buildGoalsView, eligibleGoals, formatMonthRu, isReserve, planIncome, STRATEGY_LABELS,
  type CompareResult, type CustomStrategy, type Goal, type Money, type StrategyParams, type StrategyRow,
} from '../../engine/index';
import { field, h, toast } from '../dom';
import { getState, today, update } from '../store';
import { chip, errorsBox, fmt, fmtDate, fmtDay, info, moneyInput, newId, readMoney, readStr, row, rows, seg, stickyBar, sub } from '../ui';
import { go, sheetHref } from '../main';
import { explainLink, registerExplain } from '../explain';
import { ov } from '../ctx';
import { flashGoals } from './goals';

let last: { result: CompareResult; accountId: string; amount: Money; inBalance: boolean } | null = null;
let selected = 0;
let inBalance = true;
const ACC_KEY = 'capos-income-acc';

function lastAccount(): string | null {
  try {
    return localStorage.getItem(ACC_KEY);
  } catch {
    return null;
  }
}
function rememberAccount(id: string): void {
  try {
    localStorage.setItem(ACC_KEY, id);
  } catch {
    /* хранилище недоступно — просто не запоминаем */
  }
}

/** Десятые доли месяца: 34 → «3,4». */
function tenths(t: number): string {
  return `${Math.floor(t / 10)}${t % 10 ? `,${t % 10}` : ''}`;
}

registerExplain('income', 'Как посчитано: «Доход»', () => {
  if (!last) return [];
  const r = last.result;
  const plan = r.rows.find((x) => x.ids.includes(getState().settings.planStrategy)) ?? r.rows[0];
  const cap = plan ? [6, 12, 24].map((k) => (plan.capitalAfter[k] === null ? '—' : `${k} мес. — ${fmt(plan.capitalAfter[k]!)}`)).join(', ') : '';
  return [
    ...r.step0.explanation,
    ...r.merged.map((m) => ({ code: 'compare.merged', text: m.reason })),
    ...(cap ? [{ code: 'compare.capital', text: `Капитал одинаков во всех вариантах — меняются метки, а не деньги: ${cap}` }] : []),
    ...(plan ? plan.assumptions.map((a) => ({ code: 'compare.assumption', text: a, detail: true })) : []),
  ] as never;
});

/** Чипы «цены» по сравнению с текущим планом: зелёные — лучше, жёлтые — хуже. */
function priceChips(row: StrategyRow, plan: StrategyRow | undefined, title: (id: string) => string): HTMLElement[] {
  if (!plan || row === plan) return [];
  const good: string[] = [];
  const bad: string[] = [];
  const a = row.reserveMonthsTenths;
  const b = plan.reserveMonthsTenths;
  if (a !== null && b !== null && a !== b) (a > b ? good : bad).push(`Подушка ${a > b ? '+' : '−'}${tenths(Math.abs(a - b))} мес.`);
  const shifts = (Object.entries(row.shiftVsPlan).filter(([, v]) => v !== null && v !== 0) as [string, number][]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  for (const [g, v] of shifts.slice(0, 2)) (v < 0 ? good : bad).push(`${title(g)} ${v < 0 ? 'раньше' : 'позже'} на ${Math.abs(v)} мес.`);
  if (row.gaps.length && !plan.gaps.length) bad.push(`Кассовый разрыв с ${fmtDay(row.gaps[0]!.start)}`);
  if (!good.length && !bad.length) return [chip('Сроки те же', false, undefined, 'static')];
  return [...good.map((t) => chip(t, false, undefined, 'good')), ...bad.map((t) => chip(t, false, undefined, 'warn'))];
}

/** Недофинансирование словами: required — обязательный взнос этого месяца (до срока поровну, ladder.requiredMonthly). */
function underfundedText(u: StrategyRow['underfunded'][number], g: Goal | undefined, title: string): string {
  if (g?.deadline) return `«${title}»: чтобы успеть к ${fmtDate(g.deadline)}, в этот раз нужно ${fmt(u.required)}, здесь — ${fmt(u.given)}`;
  return `«${title}»: обязательный взнос в этот раз ${fmt(u.required)}, здесь — ${fmt(u.given)}`;
}

function variantCard(v: StrategyRow, i: number, r: CompareResult, rerender: () => void): HTMLElement {
  const st = getState();
  const goals = st.goals;
  const title = (id: string) => goals.find((g) => g.id === id)?.title ?? id;
  const planId = st.settings.planStrategy;
  const plan = r.rows.find((x) => x.ids.includes(planId));
  const isPlan = v.ids.includes(planId);
  const label = v.ids.map((id) => STRATEGY_LABELS[id]).join(' = ');
  const reserveGoal = goals.find((g) => isReserve(g) && g.status === 'active');
  const dates = (Object.entries(v.goalDates) as [string, string | null][])
    .filter(([g]) => {
      const goal = goals.find((x) => x.id === g);
      // части цели не повторяем отдельно, если сама цель в списке
      return g !== reserveGoal?.id && goal?.status === 'active' && !(goal.parentId && goal.parentId in v.goalDates);
    })
    .sort((a, b) => (a[1] ?? '9999').localeCompare(b[1] ?? '9999'))
    .slice(0, 2)
    .map(([g, d]) => `${title(g)} ${d ? `к ${formatMonthRu(d as never)}` : '— за горизонтом'}`);
  const summary = [v.reserveMonthsTenths !== null ? `Подушка ${tenths(v.reserveMonthsTenths)} мес.` : null, ...dates].filter(Boolean).join(' · ');
  const now = Object.entries(v.byGoal).filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1]);
  const goalIds = [...new Set([...Object.keys(v.byGoal), ...Object.keys(v.goalDates)])].filter((g) => goals.some((x) => x.id === g));
  return h(
    'div',
    {
      class: `variant${i === selected ? ' on' : ''}`,
      role: 'radio',
      tabindex: '0',
      'aria-checked': i === selected ? 'true' : 'false',
      onclick: (e: Event) => {
        if ((e.target as HTMLElement).closest('details, a, button')) return;
        selected = i;
        rerender();
      },
      onkeydown: (e: Event) => {
        const k = (e as KeyboardEvent).key;
        if (k === 'Enter' || k === ' ') {
          e.preventDefault();
          selected = i;
          rerender();
        }
      },
    },
    h('h3', null, label, isPlan ? h('span', { class: 'tag' }, 'текущий план') : null),
    v.ids.length > 1 ? h('p', { class: 'muted' }, 'Здесь варианты совпали: денег хватает только на одни и те же цели.') : null,
    summary ? h('div', { class: 'sum-line' }, summary) : null,
    now.length ? h('div', { class: 'sum-line' }, `Сейчас: ${now.slice(0, 2).map(([g, m]) => `${title(g)} ${fmt(m)}`).join(' · ')}${now.length > 2 ? ` · ещё ${now.length - 2}` : ''}`) : null,
    (() => {
      const c = priceChips(v, plan, title);
      return c.length ? h('div', { class: 'chips wrap', 'aria-label': 'По сравнению с текущим планом' }, c) : null;
    })(),
    v.free > 0 ? h('div', { class: 'sum-line' }, `Не распределено: ${fmt(v.free)}`) : null,
    v.underfunded.length ? h('div', { class: 'warnline' }, `Не хватает на взнос к сроку: ${v.underfunded.map((u) => `«${title(u.goalId)}»`).join(', ')}`) : null,
    h(
      'details',
      { class: 'fold', 'data-key': `income:how:${v.ids.join('')}` },
      h('summary', null, 'Как распределено'),
      rows(
        goalIds.map((g) => {
          const shift = v.shiftVsPlan[g];
          const d = v.goalDates[g];
          return row({
            title: title(g),
            sub: [d ? `минимум к ${formatMonthRu(d)}` : 'минимум за горизонтом', !isPlan && shift ? `${shift > 0 ? 'позже' : 'раньше'} на ${Math.abs(shift)} мес.` : null].filter(Boolean).join(' · '),
            value: v.byGoal[g] ? fmt(v.byGoal[g]!) : '—',
          });
        }),
      ),
      v.underfunded.length ? h('div', { class: 'warnline' }, v.underfunded.map((u) => h('div', null, underfundedText(u, goals.find((g) => g.id === u.goalId), title(u.goalId))))) : null,
      v.violations.length ? h('div', { class: 'warnline' }, v.violations.map((x) => h('div', null, x))) : null,
    ),
  );
}

function form(rerender: () => void): HTMLElement {
  const st = getState();
  const v = buildGoalsView(st, today());
  const goals = eligibleGoals(v.goals).list.filter((g) => !isReserve(g));
  const liquid = v.accounts.filter((a) => a.liquidNow);
  const remembered = lastAccount();
  const def = (last?.accountId && liquid.some((a) => a.accountId === last!.accountId) ? last.accountId : null) ?? (remembered && liquid.some((a) => a.accountId === remembered) ? remembered : null) ?? [...liquid].sort((a, b) => b.balance - a.balance)[0]?.accountId;
  const amount = moneyInput('amount', last?.amount, '0');
  amount.classList.add('big-input');
  amount.setAttribute('aria-label', 'Сколько пришло, ₸');
  const balHint = h('small', { class: 'hint' });
  const setHint = () => (balHint.textContent = inBalance ? 'бэкап сделан после того, как деньги пришли — не прибавляем второй раз' : 'денег ещё нет в бэкапе — прибавим их к счёту');
  setHint();
  const segBox = h('div');
  const drawSeg = () =>
    segBox.replaceChildren(
      seg([['yes', 'Да'], ['no', 'Нет']] as const, inBalance ? 'yes' : 'no', (x) => {
        inBalance = x === 'yes';
        drawSeg();
        setHint();
      }, 'Уже есть в балансе MoneyManager?'),
    );
  drawSeg();
  const err = h('div');
  const f = h(
    'form',
    { class: 'stack', id: 'income-form' },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Сколько пришло, ₸'), amount),
    field('На какой счёт', h('select', { name: 'acc' }, liquid.map((a) => h('option', { value: a.accountId, selected: a.accountId === def }, `${a.title} · ${fmt(a.balance)}`)))),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Уже есть в балансе MoneyManager?', info('incomeInBalance')), segBox, balHint),
    h(
      'details',
      { class: 'fold', 'data-key': 'income:custom' },
      h('summary', null, 'Настроить сравнение'),
      h(
        'div',
        { class: 'stack' },
        field('«Ускорение» — какую цель', h('select', { name: 'focus' }, h('option', { value: '' }, 'самую важную'), goals.map((g) => h('option', { value: g.id }, g.title)))),
        h('p', { class: 'muted' }, 'Свой вариант — задай суммы и доли сам (необязательно):'),
        field('Подушку довести до, ₸', moneyInput('d-reserve', undefined, 'не ниже минимума')),
        ...goals.flatMap((g) => [field(`«${g.title}»: не меньше, ₸`, moneyInput(`d-min-${g.id}`, undefined, '')), field(`«${g.title}»: доля остатка, %`, h('input', { name: `d-pct-${g.id}`, inputmode: 'decimal', autocomplete: 'off' }))]),
      ),
    ),
    err,
    h('button', { class: 'btn primary wide', type: 'submit' }, 'Сравнить варианты'),
  );
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const a = readMoney(f, 'amount');
    if (a === null || a <= 0) return err.replaceChildren(errorsBox(['Введи, сколько пришло']) ?? '');
    const focus = readStr(f, 'focus');
    const strategies: StrategyParams[] = [{ id: 'A' }, { id: 'B' }, { id: 'C', ...(focus ? { focusGoalIds: [focus] } : {}) }];
    if (readStr(f, 'd-reserve')) {
      const custom: CustomStrategy = { reserveTarget: readMoney(f, 'd-reserve') ?? (0 as Money), minimums: [], rest: [] };
      for (const g of goals) {
        const m = readStr(f, `d-min-${g.id}`) ? readMoney(f, `d-min-${g.id}`) : null;
        if (m) custom.minimums.push({ goalId: g.id, amount: m });
        const p = Number(readStr(f, `d-pct-${g.id}`).replace(',', '.'));
        if (p > 0) custom.rest.push({ goalId: g.id, pctBp: Math.round(p * 100) });
      }
      strategies.push({ id: 'D', custom });
    }
    const accountId = readStr(f, 'acc');
    rememberAccount(accountId);
    const result = planIncome(getState(), today(), { amount: a, incomeInBalance: inBalance, strategies });
    const planId = getState().settings.planStrategy;
    selected = Math.max(0, result.rows.findIndex((x) => x.ids.includes(planId)));
    last = { result, accountId, amount: a, inBalance };
    rerender();
  });
  if (!last) setTimeout(() => amount.focus(), 0);
  return f;
}

export function renderIncome(rerender: () => void): HTMLElement {
  const st = getState();
  const root = h('div', { class: 'screen' });
  if (!st.imported) {
    root.append(
      h(
        'div',
        { class: 'card stack' },
        h('strong', null, 'Сначала загрузи бэкап'),
        h('p', { class: 'muted' }, 'Без него неизвестны балансы и обычные траты — делить доход не из чего.'),
        h('a', { class: 'btn primary wide', href: '#/import' }, 'Загрузить бэкап'),
      ),
    );
    return root;
  }
  if (!last) {
    root.append(h('p', { class: 'muted' }, 'Пришли деньги — посмотри, как их разложить по целям. Деньги никуда не переводятся: ставятся метки.'), form(rerender));
    return root;
  }

  const r = last.result;
  const accTitle = ov().capital.accounts.find((p) => p.accountId === last!.accountId)?.title ?? '';
  root.append(
    rows(
      row({
        title: `Пришло ${fmt(last.amount)}`,
        sub: `${accTitle} · ${last.inBalance ? 'уже в балансе' : 'ещё не в балансе'}`,
        value: 'изменить',
        onClick: () => {
          last = null;
          rerender();
        },
      }),
    ),
  );

  const next = ov().nextIncome;
  if (!r.step0.ok) {
    root.append(
      h(
        'div',
        { class: 'badline stack' },
        h('strong', null, `До дохода не хватает ${fmt(r.step0.deficit)}`),
        h('div', null, 'Платежи и обычные траты до следующего дохода больше, чем есть свободных денег. Распределять нечего.'),
        r.step0.options.length ? h('ul', null, r.step0.options.map((o) => h('li', null, o))) : null,
      ),
      explainLink('income'),
    );
    return root;
  }

  root.append(
    h(
      'div',
      { class: 'income-head' },
      h('div', { class: 'label' }, 'Можно распределить', info('step0')),
      h('div', { class: 'value' }, fmt(r.step0.available)),
      h('div', { class: 'muted' }, `после платежей и обычных трат до ${fmtDay(next.date)} · `, h('a', { href: sheetHref('explain', 'income') }, 'Как посчитано ›')),
    ),
  );
  if (!last.inBalance) root.append(h('p', { class: 'muted' }, 'Денег ещё нет в бэкапе: метки встанут только на то, что уже лежит на счёте свободным. Если не хватит — загрузи свежий бэкап и выбери «Да».'));
  for (const s of r.explanation.filter((x) => x.code === 'compare.d_invalid')) root.append(h('div', { class: 'warnline' }, s.text));
  if (selected >= r.rows.length) selected = 0;

  const cards = r.rows.map((x, i) => variantCard(x, i, r, rerender));
  const strip = h('div', { class: 'variants', role: 'radiogroup', 'aria-label': 'Варианты распределения' }, cards);
  const dots = h('div', { class: 'var-dots', 'aria-hidden': 'true' }, r.rows.map((_, i) => h('span', { class: i === selected ? 'on' : '' })));
  strip.addEventListener('scroll', () => {
    const i = Math.round(strip.scrollLeft / Math.max(1, cards[0]!.offsetWidth + 12));
    dots.querySelectorAll('span').forEach((d, k) => d.classList.toggle('on', k === i));
  });
  root.append(sub('Варианты', info('strategies')), strip);
  if (r.rows.length > 1) root.append(dots);
  // показать выбранную карточку в ленте
  setTimeout(() => cards[selected]?.scrollIntoView({ block: 'nearest', inline: 'center' }), 0);

  const note = h('input', { name: 'note', autocomplete: 'off', placeholder: 'например: премия за квартал' });
  root.append(h('details', { class: 'fold', 'data-key': 'income:note' }, h('summary', null, 'Заметка к решению'), field('Заметка (необязательно)', note)));

  const chosen = r.rows[selected]!;
  const err = h('div');
  root.append(err);
  root.append(
    stickyBar(
      h('span', null, chosen.ids.map((id) => STRATEGY_LABELS[id]).join(' = ')),
      h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          onclick: async () => {
            const before = getState();
            const res = acceptAllocation(before, r, chosen, last!.accountId, today(), newId('dec'), note.value.trim());
            if (!res.ok) {
              err.replaceChildren(errorsBox([res.error]) ?? '');
              return toast(res.error, 'error');
            }
            last = null;
            flashGoals(Object.entries(chosen.byGoal).filter(([, m]) => m > 0).map(([g]) => g));
            await update(() => res.value);
            toast('Метки поставлены, деньги никуда не переводились', { undo: () => update(() => before).then(() => toast('Отменено')) });
            go('#/goals');
          },
        },
        'Поставить метки',
      ),
    ),
  );
  return root;
}
