/** Экран «Прогноз»: три сценария, график капитала, плановые события, «что если» и альтернативы. */
import {
  buildSimInput, runAlternatives, runForecast, runWhatIf, formatMonthRu, formatDateRu,
  type LifeEvent, type LifeEventKind, type Money, type SimResult, type WhatIfResult, type AlternativeResult, incomeKindRegistry, type IncomeKind } from '../../engine/index';
import { lineChart } from '../chart';
import { confirmButton, field, h, section, table, toast } from '../dom';
import { getState, today, update } from '../store';
import { errorsBox, fmt, info, moneyInput, moneySpan, newId, readMoney, readStr } from '../ui';

const KIND_LABELS: Record<LifeEventKind, string> = {
  one_off: 'разовый расход (минус — поступление)',
  recurring_change: 'изменение расходов в месяц',
  income_start: 'новый доход в месяц',
  income_stop: 'доход прекращается',
  income_change: 'доход меняется на сумму',
  obligation_payoff: 'досрочное погашение обязательства',
};

let draft: LifeEvent[] = [];
let whatIfResult: WhatIfResult[] | null = null;
let alternatives: { id: string; title: string; events: LifeEvent[] }[] = [];
let altResult: AlternativeResult[] | null = null;

/** Форма одного события; target — список потоков дохода и обязательств. */
function eventForm(submitLabel: string, onEvent: (e: LifeEvent) => void): HTMLFormElement {
  const st = getState();
  const targets = [
    ...st.settings.incomeSchedule.map((x) => ({ id: x.id, title: `доход «${x.title}»` })),
    ...st.obligations.map((o) => ({ id: o.id, title: `обязательство «${o.title}»` })),
  ];
  const form = h(
    'form',
    { class: 'grid-form' },
    field('Название', h('input', { name: 'title', required: true, placeholder: 'Переезд, аренда, ноутбук…' })),
    field('Вид', h('select', { name: 'kind' }, (Object.keys(KIND_LABELS) as LifeEventKind[]).map((k) => h('option', { value: k }, KIND_LABELS[k])))),
    field('Дата', h('input', { name: 'date', type: 'date', value: today() })),
    field('Сумма, ₸', moneyInput('amount'), 'для погашения: 0 — весь остаток'),
    field('Действует до (необязательно)', h('input', { name: 'until', type: 'date' })),
    field('Доход / обязательство', h('select', { name: 'target' }, h('option', { value: '' }, '—'), targets.map((t) => h('option', { value: t.id }, t.title)))),
    field('День поступления (для нового дохода)', h('input', { name: 'day', type: 'number', min: 1, max: 31, class: 'short' })),
    field('Вид нового дохода', h('select', { name: 'incomeKind' }, incomeKindRegistry(st.settings.incomeKinds).map((k) => h('option', { value: k.id }, k.label))), 'от вида зависит, как доход поведёт себя в плохом сценарии'),
    h('button', { class: 'btn primary', type: 'submit' }, submitLabel),
  );
  const err = h('div');
  form.append(err);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const kind = readStr(form, 'kind') as LifeEventKind;
    const amount = readMoney(form, 'amount') ?? (0 as Money);
    const target = readStr(form, 'target');
    const errs: string[] = [];
    if (!readStr(form, 'title')) errs.push('Нужно название');
    if ((kind === 'income_stop' || kind === 'income_change' || kind === 'obligation_payoff') && !target) errs.push('Выбери доход или обязательство');
    if ((kind === 'one_off' || kind === 'recurring_change' || kind === 'income_start' || kind === 'income_change') && readMoney(form, 'amount') === null) errs.push('Введи сумму');
    err.replaceChildren(errorsBox(errs) ?? '');
    if (errs.length) return;
    const until = readStr(form, 'until');
    const dayN = Number(readStr(form, 'day'));
    onEvent({
      id: newId('ev'),
      title: readStr(form, 'title'),
      kind,
      date: readStr(form, 'date') || today(),
      amount,
      ...(target ? { target } : {}),
      ...(until ? { until } : {}),
      ...(dayN >= 1 && dayN <= 31 ? { dayOfMonth: dayN } : {}),
      ...(kind === 'income_start' ? { incomeKind: readStr(form, 'incomeKind') as IncomeKind } : {}),
    });
  });
  return form;
}

function eventLine(e: LifeEvent): string {
  return `${formatDateRu(e.date)} · ${e.title} — ${KIND_LABELS[e.kind]}${e.kind === 'income_stop' ? '' : `: ${fmt(e.amount)}`}${e.until ? ` до ${formatDateRu(e.until)}` : ''}`;
}

function delta(v: Money | null | undefined): HTMLElement | string {
  return v === null || v === undefined ? '—' : moneySpan(v, { sign: true });
}

function scenarioTable(rs: SimResult[], names: string[]): HTMLElement {
  const st = getState();
  const goalTitle = (id: string) => st.goals.find((g) => g.id === id)?.title ?? id;
  const goalIds = Object.keys(rs[0]?.goalDates ?? {});
  return table(
    ['', ...names],
    [
      ...[6, 12, 24, 36].map((k) => [`Капитал через ${k} мес.`, ...rs.map((r) => (r.capitalAfter[k] === null || r.capitalAfter[k] === undefined ? '—' : moneySpan(r.capitalAfter[k]!)))]),
      ['Минимум капитала', ...rs.map((r) => h('span', null, moneySpan(r.minCapital.value), h('small', { class: 'muted' }, ` ${formatMonthRu(r.minCapital.month)}`)))],
      [h('span', null, 'Кассовые разрывы', info('gaps')), ...rs.map((r) => (r.gaps.length ? h('span', { class: 'warn-text' }, `${r.gaps.length}, первый ${formatDateRu(r.gaps[0]!.start)}`) : 'нет'))],
      ...goalIds.map((g) => [`«${goalTitle(g)}»`, ...rs.map((r) => (r.goalDates[g] ? formatMonthRu(r.goalDates[g]!) : 'за горизонтом'))]),
    ],
    'compare',
  );
}

export function renderForecast(rerender: () => void): HTMLElement {
  const st = getState();
  const root = h('div', { class: 'screen' });
  if (!st.imported) {
    root.append(h('div', { class: 'notice info' }, 'Сначала импортируй бэкап MoneyManager.'));
    return root;
  }
  const t = today();
  const { warnings } = buildSimInput(st, t);
  const rs = runForecast(st, t);
  const names = st.settings.scenarios.map((s) => s.name);
  for (const w of warnings) root.append(h('div', { class: 'notice warn' }, w.text));
  root.append(
    section(
      h('span', null, 'Капитал по сценариям', info('scenarios')),
      lineChart(
        rs[0]!.months.map((m) => m.month),
        rs.slice(0, 3).map((r, i) => ({ name: names[i]!, short: ['база', 'хуже', 'лучше'][i], slot: (i + 1) as 1 | 2 | 3, values: r.months.map((m) => m.capital) })),
        `Капитал нетто на конец месяца, ${st.settings.simulationMonths} мес.`,
        Math.min(720, document.documentElement.clientWidth - 58),
      ),
      scenarioTable(rs, names),
      ...rs.map((r, i) =>
        r.violations.length ? h('details', { class: 'explain' }, h('summary', null, `${names[i]}: нарушения (${r.violations.length})`), h('ul', null, r.violations.map((v) => h('li', { class: 'warn' }, v)))) : null,
      ),
      h(
        'details',
        { class: 'explain' },
        h('summary', null, 'Предположения'),
        h('ul', null, rs[0]!.assumptions.map((a) => h('li', null, a))),
        // как каждый сценарий изменил доходы — по видам дохода (D75)
        ...rs.slice(1).map((r, i) => {
          const notes = r.assumptions.filter((a) => a.startsWith('Сценарий: ')).map((a) => a.slice('Сценарий: '.length));
          return notes.length ? h('div', null, h('strong', null, `${names[i + 1]}:`), h('ul', null, notes.map((n) => h('li', null, n)))) : null;
        }),
      ),
    ),
  );

  // плановые события
  root.append(
    section(
      'Плановые события',
      h('p', { class: 'muted' }, 'Переезд, аренда, выход на работу, конец стипендии — всё это события, а не особый код. Они входят во все сценарии.'),
      st.settings.plannedEvents.length
        ? h(
            'ul',
            { class: 'plain' },
            st.settings.plannedEvents.map((e) =>
              h('li', { class: 'row' }, eventLine(e), confirmButton('Удалить', 'Точно?', () => update((s) => ({ ...s, settings: { ...s.settings, plannedEvents: s.settings.plannedEvents.filter((x) => x.id !== e.id) } })))),
            ),
          )
        : null,
      h(
        'details',
        { class: 'add', 'data-key': 'forecast:planned' },
        h('summary', null, '+ Добавить событие в план'),
        eventForm('Добавить в план', (e) => {
          void update((s) => ({ ...s, settings: { ...s.settings, plannedEvents: [...s.settings.plannedEvents, e] } })).then(() => toast('Событие добавлено'));
        }),
      ),
    ),
  );

  // что если
  root.append(
    section(
      h('span', null, '«Что если» — одно решение', info('whatIf')),
      h('p', { class: 'muted' }, 'Опиши решение одним или несколькими событиями. Оно не сохраняется в план — только сравнивается с базой по трём сценариям.'),
      draft.length ? h('ul', { class: 'plain' }, draft.map((e) => h('li', null, eventLine(e)))) : null,
      h('details', { class: 'add', 'data-key': 'forecast:whatif' }, h('summary', null, '+ Событие решения'), eventForm('Добавить к решению', (e) => ((draft = [...draft, e]), (whatIfResult = null), rerender()))),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', disabled: !draft.length, onclick: () => ((whatIfResult = runWhatIf(getState(), today(), draft)), rerender()) }, 'Посчитать'),
        draft.length ? h('button', { class: 'btn', type: 'button', onclick: () => ((draft = []), (whatIfResult = null), rerender()) }, 'Очистить') : null,
      ),
      whatIfResult ? whatIfTable(whatIfResult) : null,
    ),
  );

  // альтернативы
  root.append(
    section(
      'Альтернативы бок о бок',
      h('p', { class: 'muted' }, 'Например, жильё: у родственников / вдвоём / одному. Каждая альтернатива — одно событие; до трёх.'),
      alternatives.length ? h('ul', { class: 'plain' }, alternatives.map((a) => h('li', null, `${a.title}: ${a.events.map(eventLine).join('; ')}`))) : null,
      alternatives.length < 3 ? h('details', { class: 'add', 'data-key': 'forecast:alt' }, h('summary', null, '+ Альтернатива'), eventForm('Добавить альтернативу', (e) => ((alternatives = [...alternatives, { id: e.id, title: e.title, events: [e] }]), (altResult = null), rerender()))) : null,
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', disabled: alternatives.length < 2, onclick: () => ((altResult = runAlternatives(getState(), today(), alternatives)), rerender()) }, 'Сравнить'),
        alternatives.length ? h('button', { class: 'btn', type: 'button', onclick: () => ((alternatives = []), (altResult = null), rerender()) }, 'Очистить') : null,
      ),
      altResult
        ? table(
            ['', ...altResult.map((a) => a.title)],
            [
              ...[6, 12, 24, 36].map((k) => [`Δ капитала, ${k} мес.`, ...altResult!.map((a) => delta(a.deltaCapital[k]))]),
              ['Минимум капитала', ...altResult.map((a) => h('span', null, moneySpan(a.minCapital.value), h('small', { class: 'muted' }, ` ${formatMonthRu(a.minCapital.month)}`)))],
              ['Новые разрывы', ...altResult.map((a) => (a.newGaps.length ? h('span', { class: 'warn-text' }, `с ${formatDateRu(a.newGaps[0]!.start)}`) : 'нет'))],
            ],
            'compare',
          )
        : null,
    ),
  );
  return root;
}

function whatIfTable(rs: WhatIfResult[]): HTMLElement {
  const st = getState();
  const goalTitle = (id: string) => st.goals.find((g) => g.id === id)?.title ?? id;
  const goals = Object.keys(rs[0]?.deltaGoalMonths ?? {});
  return table(
    ['', ...rs.map((r) => r.scenarioName)],
    [
      ...[6, 12, 24, 36].map((k) => [`Δ капитала, ${k} мес.`, ...rs.map((r) => delta(r.deltaCapital[k]))]),
      ['Минимум капитала: было → стало', ...rs.map((r) => `${fmt(r.minCapitalBase.value)} → ${fmt(r.minCapitalWith.value)} (${formatMonthRu(r.minCapitalWith.month)})`)],
      ['Новые кассовые разрывы', ...rs.map((r) => (r.newGaps.length ? h('span', { class: 'warn-text' }, r.newGaps.map((g) => `${formatDateRu(g.start)}–${formatDateRu(g.end)}, до ${fmt(g.maxDeficit)}`).join('; ')) : 'нет'))],
      ...goals.map((g) => [`«${goalTitle(g)}»: сдвиг`, ...rs.map((r) => (r.deltaGoalMonths[g] === null ? 'за горизонтом' : `${r.deltaGoalMonths[g]! > 0 ? '+' : ''}${r.deltaGoalMonths[g]} мес.`))]),
    ],
    'compare',
  );
}
