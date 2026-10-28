/**
 * Экран «Прогноз» (D87): срок переключателем, «Капитал через год» крупно, полоса «хуже — лучше»,
 * таблица в 4 колонки, одна строка про кассовые разрывы, «Когда достигнешь целей»,
 * «Проверить решение» (события, «что если», альтернативы) — в подэкранах.
 */
import {
  buildSimInput, runAlternatives, runForecast, runWhatIf, formatMonthRu, formatDateRu, incomeKindRegistry,
  type LifeEvent, type LifeEventKind, type Money, type MonthKey, type Scenario, type SimResult, type WhatIfResult, type AlternativeResult, type IncomeKind,
} from '../../engine/index';
import { bandChart } from '../chart';
import { ask, field, h } from '../dom';
import { act, getState, today } from '../store';
import { attention, errorsBox, fmt, fmtShort, info, moneyInput, newId, readMoney, readStr, row, rows, seg, stickyBar, sub, type AttentionItem } from '../ui';
import { defineSheet, refresh, sheetHref } from '../main';
import { explainLink, registerExplain } from '../explain';

const KIND_LABELS: Record<LifeEventKind, string> = {
  one_off: 'Разовая трата',
  recurring_change: 'Траты в месяц меняются',
  income_start: 'Новый доход',
  income_stop: 'Доход прекращается',
  income_change: 'Доход меняется',
  obligation_payoff: 'Досрочно закрыть долг',
};
const KIND_HINTS: Record<LifeEventKind, string> = {
  one_off: 'минус — разовое поступление',
  recurring_change: 'плюс — больше трат, минус — меньше',
  income_start: 'сумма в месяц',
  income_stop: 'сумма не нужна',
  income_change: 'на сколько в месяц: плюс или минус',
  obligation_payoff: '0 — весь остаток',
};

const PERIODS = [['6', '6 мес'], ['12', '1 год'], ['24', '2 года'], ['36', '3 года']] as const;
const PERIOD_WORDS: Record<string, string> = { '6': 'через 6 мес.', '12': 'через год', '24': 'через 2 года', '36': 'через 3 года' };
let period: (typeof PERIODS)[number][0] = '12';

let draft: LifeEvent[] = [];
let whatIfResult: WhatIfResult[] | null = null;
let alternatives: { id: string; title: string; events: LifeEvent[] }[] = [];
let altResult: AlternativeResult[] | null = null;

/** Названия сценариев одинаково везде: «База / Хуже / Лучше» (свои сценарии — своим именем). */
export function scenarioWord(sc: Pick<Scenario, 'id' | 'name'>): string {
  return ({ base: 'База', adverse: 'Хуже', favorable: 'Лучше' } as Record<string, string>)[sc.id] ?? sc.name;
}

interface Trio {
  base: SimResult;
  worse: SimResult;
  better: SimResult;
}
function trio(rs: SimResult[]): Trio | null {
  const by = (id: string, i: number) => rs.find((r) => r.scenarioId === id) ?? rs[i];
  const base = by('base', 0);
  if (!base) return null;
  return { base, worse: by('adverse', 1) ?? base, better: by('favorable', 2) ?? base };
}

const short = (m: Money | null | undefined) => (m === null || m === undefined ? '—' : fmtShort(m).replace(/ ₸$/, ''));

registerExplain('forecast', 'Как посчитано: «Прогноз»', () => {
  const st = getState();
  const rs = runForecast(st, today());
  const { notes } = buildSimInput(st, today());
  const out = [...notes];
  rs[0]?.assumptions.forEach((a) => out.push({ code: 'sim.assumption', text: a } as never));
  rs.forEach((r, i) => {
    const sc = st.settings.scenarios[i];
    const word = sc ? scenarioWord(sc) : r.scenarioId;
    r.assumptions.filter((a) => a.startsWith('Сценарий: ')).forEach((a) => out.push({ code: 'sim.scenario', text: `${word}: ${a.slice('Сценарий: '.length)}` } as never));
    r.violations.forEach((v) => out.push({ code: 'sim.violation', text: `${word}: ${v}`, level: 'warn' } as never));
  });
  return out;
});

function warningItems(): { items: AttentionItem[]; missing: { title: string; href: string; label: string }[] } {
  const { warnings } = buildSimInput(getState(), today());
  const missing: { title: string; href: string; label: string }[] = [];
  const items: AttentionItem[] = [];
  for (const w of warnings) {
    if (w.code === 'plan.no_expenses') missing.push({ title: 'разметка трат', href: '#/markup', label: 'Разметить траты' });
    else if (w.code === 'plan.no_income') missing.push({ title: 'доход', href: '#/setup/income', label: 'Добавить доход' });
    else if (w.code === 'plan.installments_missing') items.push({ title: 'Рассрочки не заведены', href: '#/debts' });
    else items.push({ title: w.text, href: '' });
  }
  return { items, missing };
}

export function renderForecast(_rerender: () => void): HTMLElement {
  const st = getState();
  const root = h('div', { class: 'screen' });
  if (!st.imported) {
    root.append(
      h('div', { class: 'card stack' }, h('strong', null, 'Сначала загрузи бэкап'), h('p', { class: 'muted' }, 'Прогноз строится по твоим тратам и доходам.'), h('a', { class: 'btn primary wide', href: '#/import' }, 'Загрузить бэкап')),
    );
    return root;
  }
  const { items, missing } = warningItems();
  // без трат или доходов прогноз — три совпавшие прямые; график не рисуем
  if (missing.length) {
    root.append(
      h(
        'div',
        { class: 'card stack' },
        h('strong', null, `Для прогноза нужны: ${missing.map((m) => m.title).join(', ')}`),
        h('p', { class: 'muted' }, 'Без них прогноз покажет прямую линию — это не прогноз.'),
        ...missing.map((m, i) => h('a', { class: `btn wide${i === 0 ? ' primary' : ''}`, href: m.href }, m.label)),
      ),
    );
    const att = attention(items);
    if (att) root.append(att);
    return root;
  }

  const t = today();
  const rs = runForecast(st, t);
  const tr = trio(rs);
  if (!tr) return root;
  const maxM = st.settings.simulationMonths;
  const avail = PERIODS.filter(([k]) => Number(k) <= maxM);
  if (!avail.some(([k]) => k === period)) period = avail[avail.length - 1]?.[0] ?? '12';
  const k = Number(period);

  root.append(seg(avail, period, (v) => ((period = v), refresh()), 'Срок прогноза'));
  const cap = (r: SimResult) => r.capitalAfter[k] ?? r.months[Math.min(k, r.months.length - 1)]?.capital ?? null;
  const lo = cap(tr.worse);
  const hi = cap(tr.better);
  root.append(
    h(
      'section',
      { class: 'hero', 'aria-label': `Капитал ${PERIOD_WORDS[period]}` },
      h('div', { class: 'label' }, h('span', null, `Капитал ${PERIOD_WORDS[period]}`, info('net'))),
      h('div', { class: `value${(cap(tr.base) ?? 0) < 0 ? ' neg' : ''}` }, cap(tr.base) === null ? '—' : fmtShort(cap(tr.base)!)),
      lo !== null && hi !== null && (lo !== cap(tr.base) || hi !== cap(tr.base)) ? h('div', { class: 'subline' }, `от ${short(Math.min(lo, hi) as Money)} до ${short(Math.max(lo, hi) as Money)} в плохом и хорошем сценарии`) : null,
      h('a', { class: 'link', href: sheetHref('explain', 'forecast') }, 'Как посчитано ›'),
    ),
  );

  const n = Math.min(k + 1, tr.base.months.length);
  const months = tr.base.months.slice(0, n).map((m) => m.month);
  const vals = (r: SimResult) => r.months.slice(0, n).map((m) => m.capital);
  const width = Math.min(720, Math.min(960, document.documentElement.clientWidth) - 40);
  root.append(h('div', { class: 'card' }, bandChart(months, vals(tr.base), vals(tr.worse), vals(tr.better), `Капитал на конец месяца, ${PERIODS.find(([p]) => p === period)![1]}`, width)));

  // таблица: 4 колонки и на телефоне
  const horizons = [6, 12, 24, 36].filter((m) => m <= maxM);
  root.append(
    h(
      'table',
      { class: 'tbl four' },
      h('caption', { class: 'visually-hidden' }, 'Капитал по сценариям'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Срок'), h('th', { scope: 'col' }, 'Хуже'), h('th', { scope: 'col' }, 'База'), h('th', { scope: 'col' }, 'Лучше'))),
      h(
        'tbody',
        null,
        horizons.map((m) =>
          h(
            'tr',
            { class: m === k ? 'on' : '' },
            h('th', { scope: 'row' }, m < 12 ? `${m} мес` : m === 12 ? '1 год' : `${m / 12} года`),
            h('td', null, short(tr.worse.capitalAfter[m])),
            h('td', null, h('strong', null, short(tr.base.capitalAfter[m]))),
            h('td', null, short(tr.better.capitalAfter[m])),
          ),
        ),
      ),
    ),
  );

  // кассовые разрывы — одной строкой
  const withGaps = rs.map((r, i) => ({ r, sc: st.settings.scenarios[i] })).filter((x) => x.r.gaps.length);
  root.append(
    withGaps.length
      ? h(
          'div',
          { class: 'badline stack' },
          h('strong', null, 'Кассовый разрыв', info('gaps')),
          ...withGaps.map(({ r, sc }) => h('div', null, `${sc ? scenarioWord(sc) : r.scenarioId}: с ${formatDateRu(r.gaps[0]!.start)}, не хватит до ${fmt(r.gaps[0]!.maxDeficit)}`)),
        )
      : h('div', { class: 'okline' }, 'Кассовых разрывов нет ни в одном сценарии ✓'),
  );

  const att = attention(items);
  if (att) root.append(att);

  // когда достигнешь целей
  const goals = st.goals.filter((g) => g.status === 'active' && g.id in tr.base.goalDates);
  if (goals.length) {
    const d = (x: MonthKey | null | undefined) => (x ? formatMonthRu(x) : 'за горизонтом');
    root.append(
      sub('Когда достигнешь целей', info('goalDate')),
      rows(
        goals.map((g) => {
          const b = tr.base.goalDates[g.id];
          const w = tr.worse.goalDates[g.id];
          const be = tr.better.goalDates[g.id];
          return row({ title: g.title, sub: w === be && be === b ? undefined : `лучше: ${d(be)} · хуже: ${d(w)}`, value: d(b) });
        }),
      ),
    );
  }

  // проверить решение
  root.append(
    sub('Проверить решение'),
    rows(
      row({ title: 'Плановые события', sub: 'переезд, аренда, новая работа — входят во все сценарии', value: st.settings.plannedEvents.length ? String(st.settings.plannedEvents.length) : undefined, href: sheetHref('fc-events') }),
      row({ title: 'Что если', sub: 'одно решение против текущего плана', href: sheetHref('fc-whatif') }),
      row({ title: 'Альтернативы', sub: 'два-три варианта бок о бок', href: sheetHref('fc-alt') }),
    ),
  );
  root.append(explainLink('forecast'));
  return root;
}

// ───────────────────────── события и решения (подэкраны) ─────────────────────────

/** Форма одного события; поля, которые не нужны выбранному виду, скрыты. */
function eventForm(id: string, onEvent: (e: LifeEvent) => void): HTMLFormElement {
  const st = getState();
  const incomes = st.settings.incomeSchedule.map((x) => ({ id: x.id, title: x.title }));
  const debts = st.obligations.map((o) => ({ id: o.id, title: o.title }));
  const kindSel = h('select', { name: 'kind' }, (Object.keys(KIND_LABELS) as LifeEventKind[]).map((k) => h('option', { value: k }, KIND_LABELS[k])));
  const targetSel = h('select', { name: 'target' });
  const amountField = field('Сумма, ₸', moneyInput('amount'));
  const targetField = field('Какой', targetSel);
  const dayField = field('Какого числа приходит', h('input', { name: 'day', type: 'number', min: 1, max: 31, inputmode: 'numeric' }));
  const kindField = field('Вид дохода', h('select', { name: 'incomeKind' }, incomeKindRegistry(st.settings.incomeKinds).map((k) => h('option', { value: k.id }, k.label))), 'от вида зависит, как доход поведёт себя в сценарии «Хуже»');
  const hint = h('small', { class: 'hint' });
  const sync = () => {
    const k = kindSel.value as LifeEventKind;
    hint.textContent = KIND_HINTS[k];
    amountField.hidden = k === 'income_stop';
    const list = k === 'income_stop' || k === 'income_change' ? incomes : k === 'obligation_payoff' ? debts : [];
    targetField.hidden = !list.length && !(k === 'income_stop' || k === 'income_change' || k === 'obligation_payoff');
    targetSel.replaceChildren(...list.map((t) => h('option', { value: t.id }, t.title)));
    dayField.hidden = k !== 'income_start';
    kindField.hidden = k !== 'income_start';
  };
  kindSel.addEventListener('change', sync);
  const err = h('div');
  const form = h(
    'form',
    { class: 'stack', id },
    field('Что происходит', kindSel),
    hint,
    field('Название', h('input', { name: 'title', required: true, placeholder: 'Переезд, аренда, ноутбук…', autocomplete: 'off' })),
    field('Когда', h('input', { name: 'date', type: 'date', value: today() })),
    amountField,
    targetField,
    dayField,
    kindField,
    field('Действует до (необязательно)', h('input', { name: 'until', type: 'date' })),
    err,
  );
  sync();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const kind = readStr(form, 'kind') as LifeEventKind;
    const target = readStr(form, 'target');
    const errs: string[] = [];
    if (!readStr(form, 'title')) errs.push('Нужно название');
    if ((kind === 'income_stop' || kind === 'income_change' || kind === 'obligation_payoff') && !target) errs.push(kind === 'obligation_payoff' ? 'Нет заведённых долгов' : 'Нет заведённых доходов');
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
      amount: readMoney(form, 'amount') ?? (0 as Money),
      ...(target ? { target } : {}),
      ...(until ? { until } : {}),
      ...(dayN >= 1 && dayN <= 31 ? { dayOfMonth: dayN } : {}),
      ...(kind === 'income_start' ? { incomeKind: readStr(form, 'incomeKind') as IncomeKind } : {}),
    });
    form.reset();
    sync();
  });
  return form;
}

function eventRow(e: LifeEvent, onDelete?: () => void): HTMLElement {
  return row({
    title: e.title,
    sub: `${formatDateRu(e.date)} · ${KIND_LABELS[e.kind]}${e.kind === 'income_stop' ? '' : ` · ${fmt(e.amount, e.kind !== 'income_start')}`}${e.until ? ` · до ${formatDateRu(e.until)}` : ''}`,
    value: onDelete ? h('span', { class: 'chip' }, 'Удалить') : undefined,
    onClick: onDelete,
    chevron: false,
  });
}

defineSheet('fc-events', () => {
  const st = getState();
  const form = eventForm('fc-event-form', (e) => void act((s) => ({ ...s, settings: { ...s.settings, plannedEvents: [...s.settings.plannedEvents, e] } }), `Событие «${e.title}» в плане`));
  return {
    title: 'Плановые события',
    body: h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted' }, 'То, что точно случится: переезд, аренда, выход на работу, конец стипендии. Входит во все сценарии.'),
      st.settings.plannedEvents.length
        ? rows(
            st.settings.plannedEvents.map((e) =>
              eventRow(e, async () => {
                const i = await ask({ title: `Убрать «${e.title}» из плана?`, actions: [{ label: 'Убрать', kind: 'danger' }] });
                if (i === 0) await act((s) => ({ ...s, settings: { ...s.settings, plannedEvents: s.settings.plannedEvents.filter((x) => x.id !== e.id) } }), `«${e.title}» убрано`);
              }),
            ),
          )
        : null,
      sub('Добавить событие'),
      form,
    ),
    bar: stickyBar(null, h('button', { class: 'btn primary', type: 'submit', form: 'fc-event-form' }, 'Добавить в план')),
  };
});

function delta(v: Money | null | undefined): string {
  return v === null || v === undefined ? '—' : fmtShort(v).replace(/^(?=\d)/, v > 0 ? '+' : '').replace(/ ₸$/, '');
}

defineSheet('fc-whatif', () => {
  const st = getState();
  const form = eventForm('fc-whatif-form', (e) => {
    draft = [...draft, e];
    whatIfResult = null;
    refresh();
  });
  const words0 = st.settings.scenarios.map(scenarioWord);
  const goalTitle = (id: string) => st.goals.find((g) => g.id === id)?.title ?? id;
  // столбцы в том же порядке, что на экране: Хуже · База · Лучше
  const rank = (i: number) => ({ adverse: 0, base: 1, favorable: 2 } as Record<string, number>)[st.settings.scenarios[i]?.id ?? ''] ?? 3 + i;
  const order = (whatIfResult ?? []).map((_, i) => i).sort((a, b) => rank(a) - rank(b));
  const res = whatIfResult ? order.map((i) => whatIfResult![i]!) : null;
  const words = order.map((i) => words0[i]!);
  return {
    title: 'Что если',
    body: h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted' }, 'Опиши решение одним или несколькими событиями. В план оно не сохраняется — только сравнивается с ним.', info('whatIf')),
      draft.length ? rows(draft.map((e) => eventRow(e))) : null,
      res
        ? h(
            'div',
            { class: 'stack' },
            sub('Что изменится'),
            h(
              'table',
              { class: 'tbl four' },
              h('thead', null, h('tr', null, h('th', null, 'Капитал'), ...res.map((r, i) => h('th', null, words[i] ?? r.scenarioName)))),
              h('tbody', null, [6, 12, 24, 36].filter((m) => m <= st.settings.simulationMonths).map((m) => h('tr', null, h('th', { scope: 'row' }, m < 12 ? `${m} мес` : m === 12 ? '1 год' : `${m / 12} года`), ...res.map((r) => h('td', null, delta(r.deltaCapital[m])))))),
            ),
            res.some((r) => r.newGaps.length)
              ? h('div', { class: 'badline' }, res.filter((r) => r.newGaps.length).map((r) => h('div', null, `${words[res.indexOf(r)] ?? r.scenarioName}: новый кассовый разрыв с ${formatDateRu(r.newGaps[0]!.start)}, до ${fmt(r.newGaps[0]!.maxDeficit)}`)))
              : h('div', { class: 'okline' }, 'Новых кассовых разрывов нет ✓'),
            (() => {
              const bi = order.findIndex((i) => st.settings.scenarios[i]?.id === 'base');
              const base = res[Math.max(0, bi)]!;
              const g = Object.keys(base.deltaGoalMonths ?? {}).filter((id) => base.deltaGoalMonths[id] !== 0);
              return g.length
                ? rows(g.map((id) => {
                    const v = base.deltaGoalMonths[id];
                    return row({ title: goalTitle(id), value: v === null || v === undefined ? 'за горизонтом' : `${v > 0 ? 'позже' : 'раньше'} на ${Math.abs(v)} мес.` });
                  }))
                : null;
            })(),
          )
        : null,
      sub(draft.length ? 'Ещё событие' : 'Событие решения'),
      form,
      h('button', { class: 'btn wide', type: 'submit', form: 'fc-whatif-form' }, 'Добавить событие'),
      draft.length ? h('button', { class: 'btn link', type: 'button', onclick: () => ((draft = []), (whatIfResult = null), refresh()) }, 'Очистить') : null,
    ),
    bar: stickyBar(null, h('button', { class: 'btn primary', type: 'button', disabled: !draft.length, onclick: () => ((whatIfResult = runWhatIf(getState(), today(), draft)), refresh()) }, 'Посчитать')),
  };
});

defineSheet('fc-alt', () => {
  const st = getState();
  const form = eventForm('fc-alt-form', (e) => {
    alternatives = [...alternatives, { id: e.id, title: e.title, events: [e] }];
    altResult = null;
    refresh();
  });
  const res = altResult;
  return {
    title: 'Альтернативы',
    body: h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted' }, 'Например, жильё: у родственников / вдвоём / одному. Каждая альтернатива — одно событие, до трёх.'),
      alternatives.length ? rows(alternatives.map((a) => eventRow(a.events[0]!))) : null,
      res
        ? h(
            'table',
            { class: 'tbl four' },
            h('thead', null, h('tr', null, h('th', null, 'Капитал'), ...res.map((a) => h('th', null, a.title)))),
            h(
              'tbody',
              null,
              [6, 12, 24, 36].filter((m) => m <= st.settings.simulationMonths).map((m) => h('tr', null, h('th', { scope: 'row' }, m < 12 ? `${m} мес` : m === 12 ? '1 год' : `${m / 12} года`), ...res.map((a) => h('td', null, delta(a.deltaCapital[m]))))),
              h('tr', null, h('th', { scope: 'row' }, 'Разрывы'), ...res.map((a) => h('td', null, a.newGaps.length ? `с ${formatDateRu(a.newGaps[0]!.start)}` : 'нет'))),
            ),
          )
        : null,
      alternatives.length < 3 ? [sub('Добавить альтернативу'), form, h('button', { class: 'btn wide', type: 'submit', form: 'fc-alt-form' }, 'Добавить')] : null,
      alternatives.length ? h('button', { class: 'btn link', type: 'button', onclick: () => ((alternatives = []), (altResult = null), refresh()) }, 'Очистить') : null,
    ),
    bar: stickyBar(alternatives.length < 2 ? 'нужно хотя бы две' : null, h('button', { class: 'btn primary', type: 'button', disabled: alternatives.length < 2, onclick: () => ((altResult = runAlternatives(getState(), today(), alternatives)), refresh()) }, 'Сравнить')),
  };
});

