/** Экран «Цели»: дерево с прогрессом, назначение и снятие денег, редактирование с причиной, история. */
import {
  ROLE_LABELS, STATUS_LABELS, HORIZON_LABELS, assignMoney, deleteGoal, starterGoals, buildGoalsView, changeStatus, createGoal, exampleGoals, moveFunding, updateGoal, withdrawMoney,
  type Goal, type GoalNode, type GoalRole, type GoalStatus, type GoalsView, type Importance, type Flexibility, type Money,
} from '../../engine/index';
import { confirmButton, field, h, section, table, toast } from '../dom';
import { getState, today, update } from '../store';
import { errorsBox, explainBlock, fmt, fmtDate, info, moneyInput, moneySpan, newId, readMoney, readStr, stat } from '../ui';

const ROLES = Object.keys(ROLE_LABELS) as GoalRole[];
const STATUSES = Object.keys(STATUS_LABELS) as GoalStatus[];

function options<T extends string>(values: readonly T[], labels: Record<T, string>, selected?: T): HTMLOptionElement[] {
  return values.map((v) => h('option', { value: v, selected: v === selected }, labels[v]));
}

/** Все счета: доступные — с суммой, остальные серым и с причиной (ничего не пропадает молча). */
function accountSelect(v: GoalsView, name: string): HTMLSelectElement {
  const list = [...v.allAccounts].sort((a, b) => Number(b.status === 'available') - Number(a.status === 'available'));
  return h(
    'select',
    { name },
    list.map((a) =>
      a.status === 'available'
        ? h('option', { value: a.accountId }, `${a.title} — свободно ${fmt(a.free)}`)
        : h('option', { value: a.accountId, disabled: true }, `${a.title} — ${a.reason}`),
    ),
  );
}

/** Поля цели — общие для создания и редактирования. */
function goalFields(g: Partial<Goal>, goals: Goal[], selfId?: string): HTMLElement[] {
  return [
    field('Название', h('input', { name: 'title', required: true, value: g.title ?? '' })),
    field('Роль', h('select', { name: 'role' }, options(ROLES, ROLE_LABELS, g.role ?? 'capital'))),
    field('Минимальная сумма, ₸', moneyInput('targetMin', g.targetMin)),
    field('Комфортная сумма, ₸ (необязательно)', moneyInput('targetComfort', g.targetComfort, '')),
    field('Желаемая дата', h('input', { name: 'desiredDate', type: 'date', value: g.desiredDate ?? '' })),
    field('Дедлайн', h('input', { name: 'deadline', type: 'date', value: g.deadline ?? '' })),
    field('Гибкость срока', h('select', { name: 'flexibility' }, options(['fixed', 'flexible', 'open'] as Flexibility[], { fixed: 'жёсткий', flexible: 'гибкий', open: 'открытый' }, g.flexibility ?? 'flexible'))),
    field('Важность (1–5)', h('select', { name: 'importance' }, [1, 2, 3, 4, 5].map((i) => h('option', { value: i, selected: i === (g.importance ?? 3) }, String(i))))),
    field('Минимальный взнос в месяц, ₸ (необязательно)', moneyInput('minMonthlyFunding', g.minMonthlyFunding, '')),
    field(
      'Родительская цель',
      h('select', { name: 'parentId' }, h('option', { value: '' }, '— нет —'), goals.filter((x) => x.id !== selfId).map((x) => h('option', { value: x.id, selected: x.id === g.parentId }, x.title))),
    ),
    field('Зачем', h('input', { name: 'why', value: g.why ?? '' })),
    field('Критерий выполнения', h('input', { name: 'doneCriteria', value: g.doneCriteria ?? '' })),
  ];
}

function readGoalFields(form: HTMLFormElement): { patch: Partial<Goal>; errs: string[] } {
  const errs: string[] = [];
  const targetMin = readMoney(form, 'targetMin');
  if (targetMin === null) errs.push('Минимальная сумма: введи число');
  const comfortStr = readStr(form, 'targetComfort');
  const targetComfort = comfortStr ? readMoney(form, 'targetComfort') : undefined;
  if (targetComfort === null) errs.push('Комфортная сумма: введи число или оставь пустой');
  const mmfStr = readStr(form, 'minMonthlyFunding');
  const minMonthlyFunding = mmfStr ? readMoney(form, 'minMonthlyFunding') : undefined;
  if (minMonthlyFunding === null) errs.push('Минимальный взнос: введи число или оставь пустым');
  const opt = <T,>(v: T | '' | undefined | null): T | undefined => (v === '' || v === null || v === undefined ? undefined : v);
  return {
    errs,
    patch: {
      title: readStr(form, 'title'),
      role: readStr(form, 'role') as GoalRole,
      targetMin: (targetMin ?? 0) as Money,
      targetComfort: opt(targetComfort),
      desiredDate: opt(readStr(form, 'desiredDate')),
      deadline: opt(readStr(form, 'deadline')),
      flexibility: readStr(form, 'flexibility') as Flexibility,
      importance: Number(readStr(form, 'importance')) as Importance,
      minMonthlyFunding: opt(minMonthlyFunding),
      parentId: opt(readStr(form, 'parentId')),
      why: readStr(form, 'why'),
      doneCriteria: readStr(form, 'doneCriteria'),
    },
  };
}

function nodeActions(n: GoalNode, v: GoalsView): HTMLElement {
  const g = n.goal;
  const st = getState();
  const errBox = h('div');
  const say = (errs: string[]) => errBox.replaceChildren(errorsBox(errs) ?? '');

  // назначить
  const assignForm = h('form', { class: 'grid-form' }, field('Со счёта', accountSelect(v, 'acc')), field('Сумма, ₸', moneyInput('amount')), h('button', { class: 'btn primary', type: 'submit' }, 'Назначить'));
  assignForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = readMoney(assignForm, 'amount');
    if (amount === null) return say(['Введи сумму']);
    const r = assignMoney({ id: newId('fund'), goalId: g.id, accountId: readStr(assignForm, 'acc'), amount, date: today(), decisionId: null }, { goals: v.goals, fundings: v.fundings, balances: v.balances });
    if (!r.ok) return say([r.error]);
    await update((s) => ({ ...s, fundings: [...s.fundings, r.value] }));
    toast(`Назначено ${fmt(amount)} на «${g.title}»`);
  });

  // снять / перенести
  const fundedAccs = v.accounts.filter((a) => st.fundings.some((f) => f.goalId === g.id && f.accountId === a.accountId));
  const withdrawForm = h(
    'form',
    { class: 'grid-form' },
    field('Со счёта', h('select', { name: 'acc' }, fundedAccs.map((a) => h('option', { value: a.accountId }, a.title)))),
    field('Сумма, ₸', moneyInput('amount')),
    field('Действие', h('select', { name: 'mode' }, h('option', { value: 'withdraw' }, 'снять с цели (деньги станут свободными)'), ...v.accounts.map((a) => h('option', { value: `move:${a.accountId}` }, `перенести назначение на «${a.title}»`)))),
    h('button', { class: 'btn', type: 'submit' }, 'Выполнить'),
  );
  withdrawForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = readMoney(withdrawForm, 'amount');
    if (amount === null) return say(['Введи сумму']);
    const acc = readStr(withdrawForm, 'acc');
    const mode = readStr(withdrawForm, 'mode');
    // снять можно только настоящую метку; перенос проверяет место на целевом счёте с учётом привязок (D59)
    const ctx = { goals: v.goals, fundings: mode === 'withdraw' ? st.fundings : v.fundings, balances: v.balances };
    const r = mode === 'withdraw'
      ? withdrawMoney({ id: newId('fund'), goalId: g.id, accountId: acc, amount, date: today(), decisionId: null }, ctx)
      : moveFunding({ id: newId('move'), goalId: g.id, fromAccountId: acc, toAccountId: mode.slice(5), amount, date: today(), decisionId: null }, ctx);
    if (!r.ok) return say([r.error]);
    const added = Array.isArray(r.value) ? r.value : [r.value];
    await update((s) => ({ ...s, fundings: [...s.fundings, ...added] }));
    toast('Готово');
  });

  // изменить (с причиной)
  const editForm = h('form', { class: 'grid-form' }, ...goalFields(g, v.goals, g.id), field('Причина изменения (обязательно)', h('input', { name: 'reason', required: true })), h('button', { class: 'btn primary', type: 'submit' }, 'Сохранить изменения'));
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { patch, errs } = readGoalFields(editForm);
    if (errs.length) return say(errs);
    const original = st.goals.find((x) => x.id === g.id)!;
    // сумма резерва по правилу не перезаписывается вычисленным значением
    if (original.targetRule && patch.targetMin === g.targetMin) patch.targetMin = original.targetMin;
    const r = updateGoal(original, { ...patch, unconfirmed: false }, readStr(editForm, 'reason'), today(), st.goals);
    if (!r.ok) return say([r.error]);
    await update((s) => ({ ...s, goals: s.goals.map((x) => (x.id === g.id ? r.value : x)) }));
    toast('Цель изменена');
  });

  // статус
  const statusForm = h(
    'form',
    { class: 'grid-form' },
    field('Новый статус', h('select', { name: 'status' }, options(STATUSES, STATUS_LABELS, g.status))),
    field('Причина (обязательно)', h('input', { name: 'reason', required: true })),
    h('button', { class: 'btn', type: 'submit' }, 'Сменить статус'),
  );
  statusForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const original = st.goals.find((x) => x.id === g.id)!;
    const r = changeStatus(original, readStr(statusForm, 'status') as GoalStatus, readStr(statusForm, 'reason'), today(), { goals: st.goals, fundings: st.fundings });
    if (!r.ok) return say([r.error]);
    await update((s) => ({ ...s, goals: s.goals.map((x) => (x.id === g.id ? r.value : x)) }));
    toast('Статус изменён');
  });

  // привязка счёта целиком (D59) — прямо в карточке цели
  const boundHere = st.settings.accounts.filter((a) => a.boundGoalId === g.id);
  const bindable = v.allAccounts.filter((a) => a.status === 'available' || a.status === 'empty' || a.status === 'fully_assigned');
  const setBinding = (accountId: string, goalId: string | undefined) =>
    update((s) => {
      const prev = s.settings.accounts.find((x) => x.accountId === accountId);
      const base = prev ?? { accountId, excluded: false, liquidity: { kind: 'instant' as const } };
      const { boundGoalId: _old, ...rest } = base;
      const next = { ...rest, reviewed: true, ...(goalId ? { boundGoalId: goalId } : {}) };
      return { ...s, settings: { ...s.settings, accounts: [...s.settings.accounts.filter((x) => x.accountId !== accountId), next].sort((x, y) => (x.accountId < y.accountId ? -1 : 1)) } };
    });
  const bindSel = h('select', null, bindable.map((a) => h('option', { value: a.accountId }, `${a.title} — ${fmt(a.balance)}`)));
  const bindBlock = h(
    'div',
    { class: 'stack' },
    h('p', { class: 'muted' }, 'Весь остаток счёта будет за этой целью и сам будет расти при пополнении. Подходит для отдельного счёта под цель — заначки, депозита.'),
    boundHere.length
      ? h('ul', { class: 'plain' }, boundHere.map((b) => h('li', { class: 'row' }, `«${v.allAccounts.find((a) => a.accountId === b.accountId)?.title ?? b.accountId}» привязан`, h('button', { class: 'btn small', type: 'button', onclick: () => setBinding(b.accountId, undefined).then(() => toast('Счёт отвязан')) }, 'Отвязать'))))
      : null,
    bindable.length
      ? h('div', { class: 'row' }, bindSel, h('button', { class: 'btn primary', type: 'button', onclick: () => setBinding(bindSel.value, g.id).then(() => toast('Счёт привязан к цели')) }, 'Привязать'))
      : h('small', { class: 'muted' }, 'Нет счетов, которые можно привязать: исключённые и уже привязанные к другим целям не подходят.'),
  );

  const del = deleteGoal(g.id, { goals: st.goals, fundings: st.fundings, accounts: st.settings.accounts });
  const deleteBlock = del.ok
    ? confirmButton('Удалить цель', 'Точно удалить?', () => update((s) => ({ ...s, goals: del.value.goals, fundings: del.value.fundings })).then(() => toast(`Цель «${g.title}» удалена`)))
    : h('small', { class: 'muted' }, `Удалить нельзя. ${del.error.replace(/\.$/, '')}. Или смени статус на «отменена» — тогда история сохранится.`);

  const funds = st.fundings.filter((f) => f.goalId === g.id);
  const accTitle = (id: string) => v.accounts.find((a) => a.accountId === id)?.title ?? id;
  return h(
    'details',
    { class: 'goal-actions-wrap', 'data-key': `${g.id}:actions` },
    h('summary', { class: 'btn small' }, 'Действия'),
    h(
    'div',
    { class: 'goal-actions' },
    errBox,
    g.status !== 'cancelled' && g.status !== 'done' ? h('details', { class: 'add', 'data-key': `${g.id}:assign` }, h('summary', null, 'Назначить деньги'), assignForm) : null,
    fundedAccs.length ? h('details', { class: 'add', 'data-key': `${g.id}:withdraw` }, h('summary', null, 'Снять или перенести'), withdrawForm) : null,
    h('details', { class: 'add', 'data-key': `${g.id}:edit` }, h('summary', null, 'Изменить'), editForm),
    h('details', { class: 'add', 'data-key': `${g.id}:bind` }, h('summary', null, boundHere.length ? 'Счёт привязан' : 'Привязать счёт целиком'), bindBlock),
    h('details', { class: 'add', 'data-key': `${g.id}:status` }, h('summary', null, 'Статус'), statusForm),
    h(
      'details',
      { class: 'add', 'data-key': `${g.id}:history` },
      h('summary', null, `История (${g.history.length + funds.length})`),
      table(
        ['Дата', 'Что', 'Было → стало', 'Причина'],
        [
          ...g.history.map((x) => [fmtDate(x.date), x.field, `${String(x.from ?? '—')} → ${String(x.to ?? '—')}`, x.reason]),
          ...funds.map((f) => [fmtDate(f.date), f.amount > 0 ? 'назначено' : 'снято', `${fmt(f.amount, true)} · ${accTitle(f.accountId)}`, f.decisionId ? `решение ${f.decisionId}` : 'вручную']),
        ],
      ),
    ),
    h('div', { class: 'goal-delete' }, deleteBlock),
    ),
  );
}

function goalCard(n: GoalNode, v: GoalsView): HTMLElement {
  const g = n.goal;
  const pct = Math.min(1000, n.pctPermille) / 10;
  const dim = g.status === 'paused' || g.status === 'cancelled' || g.status === 'done';
  return h(
    'li',
    { class: `goal${dim ? ' dim' : ''}` },
    h(
      'div',
      { class: 'goal-head' },
      h('strong', null, g.title),
      h('span', { class: 'badge' }, ROLE_LABELS[g.role]),
      g.status !== 'active' ? h('span', { class: 'badge warn' }, STATUS_LABELS[g.status]) : null,
      g.unconfirmed ? h('span', { class: 'badge bad' }, 'подтвердить сумму') : null,
      n.achieved ? h('span', { class: 'badge ok' }, 'минимум достигнут') : null,
    ),
    h('div', { class: 'bar', title: `${pct}%` }, h('span', { style: `width:${pct}%` })),
    h(
      'div',
      { class: 'goal-meta muted' },
      `${fmt(n.progress)} из ${fmt(g.targetMin)}${g.targetComfort ? ` (комфорт ${fmt(g.targetComfort)})` : ''} · ${pct.toFixed(1)}%`,
      n.direct !== n.progress ? ` · напрямую ${fmt(n.direct)}` : '',
      ` · важность ${g.importance} · ${HORIZON_LABELS[n.horizon]}`,
      g.deadline ? ` · до ${fmtDate(g.deadline)}` : g.desiredDate ? ` · желательно к ${fmtDate(g.desiredDate)}` : '',
      g.targetRule ? ' · сумма по правилу резерва' : '',
    ),
    (() => {
      const b = v.fundings.filter((f) => f.goalId === g.id && f.id.startsWith('bound:'));
      return b.length
        ? h('div', { class: 'goal-meta muted' }, `в том числе весь остаток: ${b.map((f) => `«${v.accounts.find((a) => a.accountId === f.accountId)?.title ?? f.accountId}» ${fmt(f.amount)}`).join(', ')} — привязка в «Настройки → Счета»`)
        : null;
    })(),
    nodeActions(n, v),
    n.children.length ? h('ul', { class: 'tree' }, n.children.map((c) => goalCard(c, v))) : null,
  );
}

function createSection(v: GoalsView): HTMLElement {
  const st = getState();
  const errBox = h('div');
  const form = h('form', { class: 'grid-form' }, ...goalFields({}, v.goals), h('button', { class: 'btn primary', type: 'submit' }, 'Создать цель'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { patch, errs } = readGoalFields(form);
    if (errs.length) return errBox.replaceChildren(errorsBox(errs) ?? '');
    const r = createGoal({ ...patch, id: newId('goal'), title: patch.title!, role: patch.role!, targetMin: patch.targetMin!, importance: patch.importance! }, st.goals, today());
    if (!r.ok) return errBox.replaceChildren(errorsBox([r.error]) ?? '');
    await update((s) => ({ ...s, goals: [...s.goals, r.value] }));
    toast('Цель создана');
  });
  return section(
    'Новая цель',
    h('details', { class: 'add' }, h('summary', null, '+ Создать цель'), form, errBox),
    !st.goals.length
      ? h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              class: 'btn primary',
              type: 'button',
              onclick: async () => {
                await update((s) => ({ ...s, goals: starterGoals(today()) }));
                toast('Создан «Резерв» — его сумма считается сама по базовым расходам');
              },
            },
            'Начать с резерва',
          ),
          h('small', { class: 'muted' }, 'Подушка на непредвиденное нужна всем; её сумма — N месяцев базовых расходов. Остальные цели создай сами: «+ Создать цель».'),
          // пример из инструкции — только для демонстрации и проверок (?demo=1), это цели одного человека
          new URLSearchParams(location.search).has('demo')
            ? h('button', { class: 'btn', type: 'button', onclick: async () => { await update((s) => ({ ...s, goals: exampleGoals(today()) })); toast('Созданы цели из примера — подтверди суммы'); } }, 'Создать пример из инструкции')
            : null,
        )
      : null,
  );
}

export function renderGoals(): HTMLElement {
  const v = buildGoalsView(getState(), today());
  const st = getState();
  const root = h('div', { class: 'screen' });

  for (const o of v.overAssigned) {
    const acc = v.accounts.find((a) => a.accountId === o.accountId);
    root.append(
      h(
        'div',
        { class: 'notice error' },
        h('div', null, `«${acc?.title ?? o.accountId}»: ${o.text}.`, info('overAssigned')),
        h(
          'div',
          { class: 'row' },
          o.options.map((x) =>
            h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: async () => {
                  const r = withdrawMoney({ id: newId('fund'), goalId: x.goalId, accountId: o.accountId, amount: x.amount, date: today(), decisionId: null, note: 'назначено больше, чем есть' }, { goals: v.goals, fundings: st.fundings, balances: v.balances });
                  if (!r.ok) return toast(r.error, 'error');
                  await update((s) => ({ ...s, fundings: [...s.fundings, r.value] }));
                  toast(`Снято ${fmt(x.amount)} с «${x.title}»`);
                },
              },
              `Снять ${fmt(x.amount)} с «${x.title}»`,
            ),
          ),
        ),
      ),
    );
  }

  root.append(
    h(
      'div',
      { class: 'stats' },
      stat(h('span', null, 'Назначено целям', info('assigned')), moneySpan(v.totalAssigned)),
      stat(h('span', null, 'Свободно', info('free')), moneySpan(v.freeMoney), 'после назначений и резерва под обязательства', v.freeMoney < 0 ? 'bad' : ''),
      stat(h('span', null, 'Базовые расходы', info('baseline')), moneySpan(v.baseline.median), `медиана за ${v.baseline.months.length} мес.`),
    ),
  );
  const ex = explainBlock(v.explanation);
  if (ex) root.append(ex);

  root.append(
    section(
      'Дерево целей',
      v.tree.length ? h('ul', { class: 'tree' }, v.tree.map((n) => goalCard(n, v))) : h('p', { class: 'muted' }, 'Целей пока нет.'),
    ),
  );
  root.append(
    section(
      'Деньги на счетах',
      h('p', { class: 'muted' }, 'Назначение — это метка на деньгах, а не перевод. Назначить можно не больше свободного остатка счёта.'),
      table(
        ['Счёт', 'Баланс', 'Свободно', ''],
        v.allAccounts.map((a) => [
          a.title,
          moneySpan(a.balance, { muted: a.status === 'excluded' || a.status === 'needs_review' }),
          a.status === 'available' ? moneySpan(a.free) : '—',
          a.status === 'available' ? '' : h('small', { class: 'muted' }, a.reason),
        ]),
      ),
    ),
  );
  root.append(createSection(v));
  if (st.goals.length) {
    root.append(
      h(
        'div',
        { class: 'row' },
        confirmButton('Удалить все цели и назначения', 'Точно? История пропадёт', () => update((s) => ({ ...s, goals: [], fundings: [] })).then(() => toast('Цели удалены'))),
      ),
    );
  }
  return root;
}
