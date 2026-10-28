/**
 * Экран «Цели» (D85): одна строка-сводка, «＋ Цель» вверху, карточки целей; всё остальное — в подэкранах.
 * Быстрая форма — три поля и шаблон; деньги закрепляются за целью в отдельном подэкране с выбором счёта.
 */
import {
  STATUS_LABELS, assignMoney, deleteGoal, buildGoalsView, changeStatus, createGoal, exampleGoals, moveFunding, updateGoal, withdrawMoney,
  type Goal, type GoalNode, type GoalRole, type GoalStatus, type GoalsView, type Horizon, type Importance, type Flexibility, type Money,
} from '../../engine/index';
import { ask, confirmButton, field, h, toast } from '../dom';
import { act, getState, today, update } from '../store';
import { chip, errorsBox, fmt, fmtDate, info, moneyInput, newId, pct, readMoney, readStr, row, rows, stickyBar, sub } from '../ui';
import { closeSheet, defineSheet, openSheet, sheetHref } from '../main';
import { explainLink, registerExplain } from '../explain';
import { cushionOffer } from '../blocks';
import { ov } from '../ctx';

/** Шаблоны вместо слова «роль»: по одному на роль; «Накопления» — по умолчанию. */
const TEMPLATES: { role: GoalRole; label: string; hint: string; flexibility?: Flexibility; importance?: Importance }[] = [
  { role: 'capital', label: 'Накопления', hint: 'Финансовая база' },
  { role: 'safety', label: 'Подушка', hint: 'Подушка', importance: 5 },
  { role: 'quality', label: 'Покупка', hint: 'Ноутбук' },
  { role: 'life_change', label: 'Переезд и перемены', hint: 'Переезд' },
  { role: 'obligation', label: 'Долг', hint: 'Вернуть долг', flexibility: 'fixed', importance: 5 },
  { role: 'growth', label: 'Учёба и рост', hint: 'Курсы' },
];
const FLEX: Record<Flexibility, string> = { fixed: 'жёсткий', flexible: 'гибкий', open: 'без срока' };

/** Горизонт словами по порогам из настроек (по умолчанию 3 / 12 / 36 мес.). */
function horizonText(hz: Horizon): string {
  const [a, b, c] = getState().settings.horizonMonths;
  const m = (n: number) => (n % 12 === 0 ? (n === 12 ? 'года' : `${n / 12} лет`) : `${n} мес.`);
  return { small: `до ${m(a)}`, medium: `до ${m(b)}`, long: `до ${m(c)}`, major: `дольше ${m(c)}` }[hz];
}

function percent(n: GoalNode): string {
  const p = n.pctPermille / 10;
  return pct(p >= 10 ? Math.floor(p) : Math.floor(p * 10) / 10);
}

function deadlineText(g: Goal): string {
  if (g.deadline) return `к ${fmtDate(g.deadline)}`;
  if (g.desiredDate) return `желательно к ${fmtDate(g.desiredDate)}`;
  return 'без срока';
}

const view = (): GoalsView => buildGoalsView(getState(), today());
const nodeOf = (v: GoalsView, id: string) => v.flat.find((n) => n.goal.id === id);

// ───────────────────────── подсветка новой цели ─────────────────────────

let flash: { id: string; until: number } | null = null;
function flashGoal(id: string): void {
  flash = { id, until: Date.now() + 2500 };
}

// ───────────────────────── форма цели ─────────────────────────

/**
 * Три поля сверху, остальное под «Подробнее». Срок из быстрой формы — это дедлайн:
 * по нему лестница и симулятор считают, сколько нужно откладывать (желаемая дата влияет только на горизонт).
 */
function goalForm(id: string, g: Partial<Goal>, goals: Goal[], opts: { withTemplates: boolean; withReason: boolean }): { form: HTMLFormElement; read: () => { patch: Partial<Goal>; errs: string[] } } {
  let role: GoalRole = g.role ?? 'capital';
  const title = h('input', { name: 'title', required: true, value: g.title ?? '', placeholder: TEMPLATES.find((t) => t.role === role)?.hint ?? '', autocomplete: 'off' });
  const amount = moneyInput('targetMin', g.targetMin && g.targetMin > 0 ? g.targetMin : undefined);
  const when = h('input', { name: 'deadline', type: 'date', value: g.deadline ?? '' });
  const flexSel = h('select', { name: 'flexibility' }, (Object.keys(FLEX) as Flexibility[]).map((f) => h('option', { value: f, selected: f === (g.flexibility ?? 'flexible') }, FLEX[f])));
  const impSel = h('select', { name: 'importance' }, [1, 2, 3, 4, 5].map((i) => h('option', { value: i, selected: i === (g.importance ?? 3) }, String(i))));
  const summaryText = () => `Подробнее · важность ${impSel.value}, срок ${FLEX[flexSel.value as Flexibility]}`;
  const summary = h('summary', null, summaryText());
  flexSel.addEventListener('change', () => (summary.textContent = summaryText()));
  impSel.addEventListener('change', () => (summary.textContent = summaryText()));

  const chips = h('div', { class: 'chips wrap', role: 'radiogroup', 'aria-label': 'Шаблон цели' });
  const drawChips = () =>
    chips.replaceChildren(
      ...TEMPLATES.map((t) =>
        chip(t.label, t.role === role, () => {
          role = t.role;
          title.placeholder = t.hint;
          if (t.flexibility) flexSel.value = t.flexibility;
          if (t.importance) impSel.value = String(t.importance);
          summary.textContent = summaryText();
          drawChips();
        }),
      ),
    );
  drawChips();

  const form = h(
    'form',
    { class: 'stack', id },
    opts.withTemplates ? chips : null,
    field('Название', title),
    field('Сколько нужно, ₸', amount, g.targetRule ? 'считается по правилу подушки — можно задать вручную' : undefined),
    field('К какому сроку (необязательно)', when),
    h(
      'details',
      { class: 'fold', 'data-key': `${id}:more` },
      summary,
      h(
        'div',
        { class: 'stack' },
        field('Важность (1–5)', impSel),
        field('Срок', flexSel, 'жёсткий — позже нельзя; гибкий — можно сдвинуть'),
        field('Желаемая дата (раньше срока)', h('input', { name: 'desiredDate', type: 'date', value: g.desiredDate ?? '' })),
        field('Комфортная сумма, ₸', moneyInput('targetComfort', g.targetComfort, 'необязательно')),
        field('Откладывать в месяц не меньше, ₸', moneyInput('minMonthlyFunding', g.minMonthlyFunding, 'необязательно')),
        field(
          'Часть другой цели',
          h('select', { name: 'parentId' }, h('option', { value: '' }, 'нет'), goals.filter((x) => x.id !== g.id).map((x) => h('option', { value: x.id, selected: x.id === g.parentId }, x.title))),
        ),
        field('Зачем', h('input', { name: 'why', value: g.why ?? '', autocomplete: 'off' })),
        field('Когда цель выполнена', h('input', { name: 'doneCriteria', value: g.doneCriteria ?? '', autocomplete: 'off' })),
      ),
    ),
    opts.withReason ? field('Почему меняешь', h('input', { name: 'reason', required: true, autocomplete: 'off' }), 'сохранится в истории цели') : null,
  );

  const read = () => {
    const errs: string[] = [];
    const targetMin = readMoney(form, 'targetMin');
    if (targetMin === null && !g.targetRule) errs.push('Сколько нужно: введи сумму');
    const opt = <T,>(v: T | '' | undefined | null): T | undefined => (v === '' || v === null || v === undefined ? undefined : v);
    const money = (name: string, label: string) => {
      if (!readStr(form, name)) return undefined;
      const m = readMoney(form, name);
      if (m === null) errs.push(`${label}: введи число или оставь пустым`);
      return m ?? undefined;
    };
    const targetComfort = money('targetComfort', 'Комфортная сумма');
    const minMonthlyFunding = money('minMonthlyFunding', 'Откладывать в месяц');
    return {
      errs,
      patch: {
        title: readStr(form, 'title'),
        role,
        targetMin: (targetMin ?? g.targetMin ?? 0) as Money,
        targetComfort,
        deadline: opt(readStr(form, 'deadline')),
        desiredDate: opt(readStr(form, 'desiredDate')),
        flexibility: readStr(form, 'flexibility') as Flexibility,
        importance: Number(readStr(form, 'importance')) as Importance,
        minMonthlyFunding,
        parentId: opt(readStr(form, 'parentId')),
        why: readStr(form, 'why'),
        doneCriteria: readStr(form, 'doneCriteria'),
      },
    };
  };
  return { form, read };
}

defineSheet('goal-new', () => {
  const st = getState();
  const err = h('div');
  const { form, read } = goalForm('goal-new-form', {}, st.goals, { withTemplates: true, withReason: false });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { patch, errs } = read();
    if (errs.length) return err.replaceChildren(errorsBox(errs) ?? '');
    const r = createGoal({ ...patch, id: newId('goal'), title: patch.title!, role: patch.role!, targetMin: patch.targetMin!, importance: patch.importance! }, getState().goals, today());
    if (!r.ok) return err.replaceChildren(errorsBox([r.error]) ?? '');
    const id = r.value.id;
    flashGoal(id);
    await update((s) => ({ ...s, goals: [...s.goals, r.value] }));
    closeSheet();
    toast(`Цель «${r.value.title}» создана`, { action: { label: 'Закрепить деньги', run: () => openSheet('goal-fund', id) } });
  });
  return {
    title: 'Новая цель',
    body: h('div', { class: 'stack' }, form, err),
    bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'goal-new-form' }, 'Создать цель')),
  };
});

// ───────────────────────── карточка и экран ─────────────────────────

function stateTag(n: GoalNode): HTMLElement | null {
  const g = n.goal;
  if (g.unconfirmed) return h('span', { class: 'tag warn' }, 'подтверди сумму');
  if (g.status !== 'active') return h('span', { class: g.status === 'done' ? 'tag good' : 'tag' }, STATUS_LABELS[g.status]);
  if (n.achieved) return h('span', { class: 'tag good' }, 'минимум есть');
  return null;
}

function goalCard(n: GoalNode, v: GoalsView, depth = 0): HTMLElement[] {
  const g = n.goal;
  const dim = g.status === 'paused' || g.status === 'cancelled' || g.status === 'done';
  const width = Math.min(100, n.pctPermille / 10);
  const bound = v.fundings.filter((f) => f.goalId === g.id && f.id.startsWith('bound:'));
  const card = h(
    'a',
    { class: `goal-card${depth ? ' child' : ''}${dim ? ' dim' : ''}${flash && flash.id === g.id && Date.now() < flash.until ? ' flash' : ''}`, href: sheetHref('goal', g.id), 'data-goal': g.id, style: depth > 1 ? `margin-left:${16 * depth}px;width:calc(100% - ${16 * depth}px)` : undefined },
    h('div', { class: 'gh' }, h('span', { class: 'gt' }, g.title), stateTag(n)),
    h('div', { class: `bar${n.achieved ? ' done' : ''}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(width)), 'aria-label': `Прогресс «${g.title}»` }, h('span', { style: `width:${width}%` })),
    h('div', { class: 'gm' }, `${fmt(n.progress)} из ${fmt(g.targetMin)} · ${percent(n)}`),
    h('div', { class: 'gm' }, g.deadline || g.desiredDate ? `${deadlineText(g)} · ${horizonText(n.horizon)}` : 'без срока'),
    bound.length ? h('div', { class: 'gm' }, `весь остаток: ${bound.map((f) => v.allAccounts.find((a) => a.accountId === f.accountId)?.title ?? f.accountId).join(', ')}`) : null,
  );
  return [card, ...n.children.flatMap((c) => goalCard(c, v, depth + 1))];
}

registerExplain('goals', 'Как посчитано: «Цели»', () => view().explanation);

export function renderGoals(): HTMLElement {
  const v = view();
  const st = getState();
  const hasData = ov().hasData;
  const root = h('div', { class: 'screen' });

  // назначено больше, чем есть на счёте: красный блок с готовыми вариантами
  for (const o of v.overAssigned) {
    const acc = v.accounts.find((a) => a.accountId === o.accountId);
    root.append(
      h(
        'div',
        { class: 'badline stack' },
        h('div', null, `«${acc?.title ?? o.accountId}»: ${o.text}.`, info('overAssigned')),
        h(
          'div',
          { class: 'btn-row' },
          o.options.map((x) =>
            h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: async () => {
                  const r = withdrawMoney({ id: newId('fund'), goalId: x.goalId, accountId: o.accountId, amount: x.amount, date: today(), decisionId: null, note: 'закреплено больше, чем есть' }, { goals: v.goals, fundings: st.fundings, balances: v.balances });
                  if (!r.ok) return toast(r.error, 'error');
                  await act((s) => ({ ...s, fundings: [...s.fundings, r.value] }), `Снято ${fmt(x.amount)} с «${x.title}»`);
                },
              },
              `Снять ${fmt(x.amount)} с «${x.title}»`,
            ),
          ),
        ),
      ),
    );
  }

  // сводка одной строкой и «＋ Цель» справа
  root.append(
    h(
      'div',
      { class: 'goals-sum' },
      hasData
        ? h(
            'div',
            { class: 'gs-text' },
            h('span', null, 'За целями ', h('strong', null, fmt(v.totalAssigned)), info('assigned')),
            h('span', { class: v.freeMoney < 0 ? 'neg' : '' }, 'свободно ', h('strong', null, fmt(v.freeMoney)), info('free')),
          )
        : h('div', { class: 'gs-text' }, h('span', null, 'Сколько свободно, будет видно после ', h('a', { href: '#/import' }, 'загрузки бэкапа'))),
      h('a', { class: 'btn primary', href: sheetHref('goal-new') }, '＋ Цель'),
    ),
  );

  const offer = hasData ? cushionOffer() : null;
  if (offer) root.append(offer);

  if (v.tree.length) {
    root.append(sub('Цели'), h('div', { class: 'goal-list' }, v.tree.flatMap((n) => goalCard(n, v))));
  } else {
    root.append(
      h(
        'div',
        { class: 'card stack' },
        h('strong', null, 'Целей пока нет'),
        h('p', { class: 'muted' }, 'Цель — сумма, к которой копишь. Деньги остаются на счетах, за целью они просто закрепляются.'),
        h('a', { class: 'btn wide', href: sheetHref('goal-new') }, 'Создать свою цель ›'),
        // пример из инструкции — только для демонстрации и проверок (?demo=1): это цели одного человека
        new URLSearchParams(location.search).has('demo')
          ? h('button', { class: 'btn', type: 'button', onclick: () => act((s) => ({ ...s, goals: exampleGoals(today()) }), 'Созданы цели из примера — подтверди суммы') }, 'Создать пример из инструкции')
          : null,
      ),
    );
  }

  if (hasData) root.append(explainLink('goals'));
  if (st.goals.length) {
    root.append(
      h(
        'div',
        { class: 'foot-note' },
        confirmButton('Удалить все цели', 'Удалить', () => update((s) => ({ ...s, goals: [], fundings: [] })).then(() => toast('Цели удалены')), 'danger link', 'Все цели и закреплённые суммы пропадут вместе с историей. Деньги на счетах не изменятся.'),
      ),
    );
  }

  // новая цель: прокрутить к ней и подсветить
  if (flash && Date.now() < flash.until) {
    const id = flash.id;
    setTimeout(() => document.querySelector(`[data-goal="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
  }
  return root;
}

// ───────────────────────── подэкран цели: действия ─────────────────────────

defineSheet('goal', (id) => {
  const v = view();
  const n = nodeOf(v, id);
  if (!n) return null;
  const g = n.goal;
  const st = getState();
  const open = g.status !== 'cancelled' && g.status !== 'done';
  const funded = st.fundings.some((f) => f.goalId === g.id) && v.accounts.some((a) => st.fundings.some((f) => f.goalId === g.id && f.accountId === a.accountId));
  const bound = st.settings.accounts.some((a) => a.boundGoalId === g.id);
  const histN = g.history.length + st.fundings.filter((f) => f.goalId === g.id).length;
  const del = deleteGoal(g.id, { goals: st.goals, fundings: st.fundings, accounts: st.settings.accounts });

  const remove = async () => {
    if (!del.ok) return;
    const i = await ask({ title: `Удалить «${g.title}»?`, text: 'История цели пропадёт. Если хочешь её сохранить — смени статус на «отменена».', actions: [{ label: 'Удалить', kind: 'danger' }] });
    if (i !== 0) return;
    closeSheet();
    await act((s) => ({ ...s, goals: del.value.goals, fundings: del.value.fundings }), `Цель «${g.title}» удалена`);
  };

  return {
    title: g.title,
    body: h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'card stack' },
        h('div', { class: 'gh' }, h('strong', null, `${fmt(n.progress)} из ${fmt(g.targetMin)}`), stateTag(n)),
        h('div', { class: `bar${n.achieved ? ' done' : ''}` }, h('span', { style: `width:${Math.min(100, n.pctPermille / 10)}%` })),
        h('div', { class: 'muted' }, `${percent(n)} · ${deadlineText(g)} · важность ${g.importance}`),
        n.remainingMin > 0 ? h('div', { class: 'muted' }, `осталось ${fmt(n.remainingMin)}`) : null,
        n.direct !== n.progress ? h('div', { class: 'muted' }, `напрямую ${fmt(n.direct)}, остальное — в частях цели`) : null,
        g.targetRule ? h('div', { class: 'muted' }, 'сумма считается по правилу подушки: месяцы обычных базовых трат', info('baseline')) : null,
        g.why ? h('div', { class: 'muted' }, `Зачем: ${g.why}`) : null,
      ),
      rows(
        open ? row({ title: 'Закрепить деньги', sub: 'деньги остаются на счёте — это метка', href: sheetHref('goal-fund', g.id) }) : null,
        funded ? row({ title: 'Снять или перенести', href: sheetHref('goal-unfund', g.id) }) : null,
        row({ title: 'Изменить', href: sheetHref('goal-edit', g.id) }),
        row({ title: bound ? 'Счёт привязан целиком' : 'Привязать счёт целиком', href: sheetHref('goal-bind', g.id) }),
        row({ title: 'Статус', value: STATUS_LABELS[g.status], href: sheetHref('goal-status', g.id) }),
        row({ title: 'История', value: String(histN), href: sheetHref('goal-history', g.id) }),
      ),
      del.ok
        ? h('button', { class: 'btn danger wide', type: 'button', onclick: remove }, 'Удалить цель')
        : h('p', { class: 'muted' }, `Удалить нельзя: ${del.error.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}. Можно сменить статус на «отменена» — история сохранится.`),
    ),
  };
});

// закрепить деньги: выбор счёта строками (бывший блок «Деньги на счетах»)
defineSheet('goal-fund', (id) => {
  const v = view();
  const n = nodeOf(v, id);
  if (!n) return null;
  const g = n.goal;
  // настоящие счета первыми, оценка сбережений вне MoneyManager — последней
  const estimate = new Set(ov().capital.accounts.filter((p) => p.source === 'savings_flow').map((p) => p.accountId));
  const avail = v.allAccounts.filter((a) => a.status === 'available').sort((a, b) => Number(estimate.has(a.accountId)) - Number(estimate.has(b.accountId)) || b.free - a.free);
  const other = v.allAccounts.filter((a) => a.status !== 'available' && a.status !== 'excluded');
  let acc = avail[0]?.accountId ?? '';
  const err = h('div');
  const amount = moneyInput('amount');
  const form = h('form', { id: 'goal-fund-form', class: 'stack' });
  const list = h('div', { class: 'rows', role: 'radiogroup', 'aria-label': 'Счёт' });
  const quick = h('div', { class: 'chips wrap' });
  const drawQuick = () => {
    const a = avail.find((x) => x.accountId === acc);
    const items: [string, Money][] = [];
    if (a && n.remainingMin > 0) items.push([`Сколько не хватает · ${fmt(Math.min(n.remainingMin, a.free) as Money)}`, Math.min(n.remainingMin, a.free) as Money]);
    if (a) items.push([`Всё свободное · ${fmt(a.free)}`, a.free]);
    quick.replaceChildren(...items.map(([l, m]) => chip(l, false, () => (amount.value = String(Math.floor(m / 100))))));
  };
  const draw = () => {
    list.replaceChildren(
      ...avail.map((a) => row({ title: a.title, sub: `свободно ${fmt(a.free)}${estimate.has(a.accountId) ? ' · оценка' : ''}`, value: a.accountId === acc ? '✓' : undefined, cls: a.accountId === acc ? 'on' : '', chevron: false, onClick: () => { acc = a.accountId; draw(); drawQuick(); } })),
    );
  };
  draw();
  drawQuick();
  form.append(sub('Со счёта'), avail.length ? list : h('p', { class: 'muted' }, 'Нет счетов со свободными деньгами.'), field('Сколько, ₸', amount), quick, err);
  if (other.length) form.append(h('details', { class: 'fold', 'data-key': 'fund:other' }, h('summary', null, `Почему нет других счетов (${other.length})`), rows(other.map((a) => row({ title: a.title, sub: a.reason, value: fmt(a.balance) })))));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = readMoney(form, 'amount');
    if (m === null) return err.replaceChildren(errorsBox(['Введи сумму']) ?? '');
    const cur = view();
    const r = assignMoney({ id: newId('fund'), goalId: g.id, accountId: acc, amount: m, date: today(), decisionId: null }, { goals: cur.goals, fundings: cur.fundings, balances: cur.balances });
    if (!r.ok) return err.replaceChildren(errorsBox([r.error]) ?? '');
    closeSheet();
    await act((s) => ({ ...s, fundings: [...s.fundings, r.value] }), `${fmt(m)} закреплено за «${g.title}»`);
  });
  return {
    title: `Закрепить за «${g.title}»`,
    body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Деньги остаются на счёте — это метка. Закрепить можно не больше свободного остатка.'), form),
    bar: avail.length ? stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'goal-fund-form' }, 'Закрепить')) : undefined,
  };
});

defineSheet('goal-unfund', (id) => {
  const v = view();
  const st = getState();
  const g = v.goals.find((x) => x.id === id);
  if (!g) return null;
  const fundedAccs = v.accounts.filter((a) => st.fundings.some((f) => f.goalId === g.id && f.accountId === a.accountId));
  const err = h('div');
  const form = h(
    'form',
    { id: 'goal-unfund-form', class: 'stack' },
    field('Со счёта', h('select', { name: 'acc' }, fundedAccs.map((a) => h('option', { value: a.accountId }, a.title)))),
    field('Сколько, ₸', moneyInput('amount')),
    field('Что сделать', h('select', { name: 'mode' }, h('option', { value: 'withdraw' }, 'Снять с цели'), ...v.accounts.map((a) => h('option', { value: `move:${a.accountId}` }, `Перенести на «${a.title}»`))), 'перенос — когда ты сам перевёл деньги на другой счёт'),
    err,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = readMoney(form, 'amount');
    if (amount === null) return err.replaceChildren(errorsBox(['Введи сумму']) ?? '');
    const acc = readStr(form, 'acc');
    const mode = readStr(form, 'mode');
    const cur = view();
    // снять можно только настоящую метку; перенос проверяет место на целевом счёте с учётом привязок (D59)
    const ctx = { goals: cur.goals, fundings: mode === 'withdraw' ? getState().fundings : cur.fundings, balances: cur.balances };
    const r = mode === 'withdraw'
      ? withdrawMoney({ id: newId('fund'), goalId: g.id, accountId: acc, amount, date: today(), decisionId: null }, ctx)
      : moveFunding({ id: newId('move'), goalId: g.id, fromAccountId: acc, toAccountId: mode.slice(5), amount, date: today(), decisionId: null }, ctx);
    if (!r.ok) return err.replaceChildren(errorsBox([r.error]) ?? '');
    const added = Array.isArray(r.value) ? r.value : [r.value];
    closeSheet();
    await act((s) => ({ ...s, fundings: [...s.fundings, ...added] }), mode === 'withdraw' ? `Снято ${fmt(amount)} с «${g.title}»` : 'Перенесено');
  });
  return { title: 'Снять или перенести', body: form, bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'goal-unfund-form' }, 'Готово')) };
});

defineSheet('goal-edit', (id) => {
  const st = getState();
  const original = st.goals.find((x) => x.id === id);
  if (!original) return null;
  const shown = view().goals.find((x) => x.id === id) ?? original;
  const err = h('div');
  const { form, read } = goalForm('goal-edit-form', shown, st.goals, { withTemplates: true, withReason: true });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { patch, errs } = read();
    if (errs.length) return err.replaceChildren(errorsBox(errs) ?? '');
    // сумма подушки по правилу не перезаписывается вычисленным значением
    if (original.targetRule && patch.targetMin === shown.targetMin) patch.targetMin = original.targetMin;
    const r = updateGoal(original, { ...patch, unconfirmed: false }, readStr(form, 'reason'), today(), st.goals);
    if (!r.ok) return err.replaceChildren(errorsBox([r.error]) ?? '');
    closeSheet();
    await act((s) => ({ ...s, goals: s.goals.map((x) => (x.id === id ? r.value : x)) }), 'Цель изменена');
  });
  return { title: 'Изменить цель', body: h('div', { class: 'stack' }, form, err), bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'goal-edit-form' }, 'Сохранить')) };
});

defineSheet('goal-status', (id) => {
  const st = getState();
  const g = st.goals.find((x) => x.id === id);
  if (!g) return null;
  const err = h('div');
  let status: GoalStatus = g.status;
  const list = h('div', { class: 'rows', role: 'radiogroup', 'aria-label': 'Статус' });
  const draw = () => list.replaceChildren(...(Object.keys(STATUS_LABELS) as GoalStatus[]).map((s) => row({ title: STATUS_LABELS[s], value: s === status ? '✓' : undefined, cls: s === status ? 'on' : '', chevron: false, onClick: () => { status = s; draw(); } })));
  draw();
  const form = h('form', { id: 'goal-status-form', class: 'stack' }, list, field('Почему', h('input', { name: 'reason', required: true, autocomplete: 'off' }), 'сохранится в истории цели'), err);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = getState();
    const r = changeStatus(cur.goals.find((x) => x.id === id)!, status, readStr(form, 'reason'), today(), { goals: cur.goals, fundings: cur.fundings });
    if (!r.ok) return err.replaceChildren(errorsBox([r.error]) ?? '');
    closeSheet();
    await act((s) => ({ ...s, goals: s.goals.map((x) => (x.id === id ? r.value : x)) }), `Статус: ${STATUS_LABELS[status]}`);
  });
  return { title: 'Статус цели', body: form, bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'goal-status-form' }, 'Сменить')) };
});

// привязка счёта целиком (D59)
defineSheet('goal-bind', (id) => {
  const v = view();
  const st = getState();
  const g = v.goals.find((x) => x.id === id);
  if (!g) return null;
  const boundHere = st.settings.accounts.filter((a) => a.boundGoalId === g.id);
  const bindable = v.allAccounts.filter((a) => a.status === 'available' || a.status === 'empty' || a.status === 'fully_assigned');
  const title = (accId: string) => v.allAccounts.find((a) => a.accountId === accId)?.title ?? accId;
  const setBinding = (accountId: string, goalId: string | undefined, msg: string) =>
    act((s) => {
      const prev = s.settings.accounts.find((x) => x.accountId === accountId);
      const base = prev ?? { accountId, excluded: false, liquidity: { kind: 'instant' as const } };
      const { boundGoalId: _old, ...rest } = base;
      const next = { ...rest, reviewed: true, ...(goalId ? { boundGoalId: goalId } : {}) };
      return { ...s, settings: { ...s.settings, accounts: [...s.settings.accounts.filter((x) => x.accountId !== accountId), next].sort((x, y) => (x.accountId < y.accountId ? -1 : 1)) } };
    }, msg);
  return {
    title: 'Счёт целиком',
    body: h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted' }, 'Весь остаток счёта будет за этой целью и сам вырастет при пополнении. Подходит для отдельного счёта под цель — заначки, депозита.'),
      boundHere.length ? [sub('Привязан'), rows(boundHere.map((b) => row({ title: title(b.accountId), value: h('span', { class: 'chip' }, 'Отвязать'), onClick: () => void setBinding(b.accountId, undefined, 'Счёт отвязан') })))] : null,
      bindable.length
        ? [sub('Можно привязать'), rows(bindable.map((a) => row({ title: a.title, sub: fmt(a.balance), value: h('span', { class: 'chip' }, 'Привязать'), onClick: () => void setBinding(a.accountId, g.id, `«${a.title}» привязан к «${g.title}»`) })))]
        : h('p', { class: 'muted' }, 'Нет счетов, которые можно привязать: неучитываемые и уже привязанные к другим целям не подходят.'),
    ),
  };
});

const FIELD_LABELS: Record<string, string> = {
  created: 'создана', title: 'название', role: 'шаблон', targetMin: 'сумма', targetComfort: 'комфортная сумма', deadline: 'срок', desiredDate: 'желаемая дата',
  flexibility: 'гибкость срока', importance: 'важность', minMonthlyFunding: 'взнос в месяц', parentId: 'часть цели', why: 'зачем', doneCriteria: 'когда выполнена', status: 'статус', unconfirmed: 'сумма подтверждена',
};

defineSheet('goal-history', (id) => {
  const v = view();
  const st = getState();
  const g = st.goals.find((x) => x.id === id);
  if (!g) return null;
  const accTitle = (a: string) => v.allAccounts.find((x) => x.accountId === a)?.title ?? a;
  const show = (x: unknown) => (x === null || x === undefined || x === '' ? '—' : typeof x === 'number' && x > 1000 ? fmt(x as Money) : String(x));
  const items = [
    ...g.history.map((x) => ({ date: x.date, title: x.field === 'created' ? 'Создана' : `${FIELD_LABELS[x.field] ?? x.field}: ${show(x.from)} → ${show(x.to)}`, sub: x.field === 'created' ? '' : x.reason })),
    ...st.fundings.filter((f) => f.goalId === id).map((f) => ({ date: f.date, title: `${f.amount > 0 ? 'Закреплено' : 'Снято'} ${fmt((f.amount > 0 ? f.amount : -f.amount) as Money)}`, sub: `${accTitle(f.accountId)} · ${f.decisionId ? 'по распределению дохода' : 'вручную'}` })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
  return { title: `История «${g.title}»`, body: rows(items.map((i) => row({ title: i.title, sub: [fmtDate(i.date), i.sub].filter(Boolean).join(' · ') }))) };
});
