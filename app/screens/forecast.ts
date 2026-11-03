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
import { ov } from '../ctx';
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

/** Сценарий совпал с базой во всех месяцах — показывать его отдельно незачем (D93). */
const sameAs = (a: SimResult, b: SimResult) => a.months.length === b.months.length && a.months.every((m, i) => m.capital === b.months[i]!.capital);

/** Что меняет сценарий — словами (D93), из его параметров. */
function describeScenario(sc: Scenario): string[] {
  const p = sc.patch;
  const labels = Object.fromEntries(incomeKindRegistry(getState().settings.incomeKinds).map((k) => [k.id, k.label]));
  const pct = (bp: number) => `${bp > 10000 ? '+' : '−'}${(Math.abs(bp - 10000) / 100).toLocaleString('ru-RU')} %`;
  const out: string[] = [];
  if (p.workIncomeFactorBp !== undefined && p.workIncomeFactorBp !== 10000) out.push(`доход от работы ${pct(p.workIncomeFactorBp)}`);
  if (p.workDelayMonths) out.push(`новая работа начинается на ${p.workDelayMonths} мес. позже`);
  if (p.irregularIncomeFactorBp !== undefined && p.irregularIncomeFactorBp !== 10000) out.push(p.irregularIncomeFactorBp === 0 ? 'нерегулярного дохода нет' : `нерегулярный доход ${pct(p.irregularIncomeFactorBp)}`);
  for (const [k, bp] of Object.entries(p.incomeFactorsBp ?? {})) if (bp !== 10000) out.push(`доход «${labels[k] ?? k}» ${pct(bp)}`);
  for (const [k, m] of Object.entries(p.incomeDelayMonths ?? {})) if (m) out.push(`доход «${labels[k] ?? k}» начинается на ${m} мес. позже`);
  if (p.expenseFactorBp !== undefined && p.expenseFactorBp !== 10000) out.push(`траты ${pct(p.expenseFactorBp)}`);
  if (p.oneOffMonthsOfBaseBp) out.push(`разовая непредвиденная трата — ${(p.oneOffMonthsOfBaseBp / 10000).toLocaleString('ru-RU')} мес. обычных трат`);
  return out;
}

defineSheet('fc-scenarios', () => {
  const st = getState();
  const rs = runForecast(st, today());
  const base = rs.find((r) => r.scenarioId === 'base') ?? rs[0];
  return {
    title: 'Что значит «хуже» и «лучше»',
    body: h(
      'div',
      { class: 'stack' },
      h('p', null, '«База» — если всё пойдёт как сейчас: те же доходы и траты, что в последние месяцы, с ростом цен.'),
      ...st.settings.scenarios
        .filter((sc) => sc.id !== 'base')
        .map((sc) => {
          const r = rs.find((x) => x.scenarioId === sc.id);
          const d = describeScenario(sc);
          const same = !!(r && base && sameAs(r, base));
          return h(
            'div',
            { class: 'card stack tight' },
            h('strong', null, scenarioWord(sc)),
            h('div', null, d.length ? `Меняет: ${d.join('; ')}.` : 'Ничего не меняет.'),
            same ? h('div', { class: 'muted' }, 'У тебя совпадает с «Базой»: то, что меняет этот сценарий, в твоих данных не встречается (например, нет дохода от работы).') : null,
          );
        }),
      h('a', { class: 'btn', href: '#/advanced/scenarios' }, 'Изменить сценарии'),
    ),
  };
});

/** «Почему этот месяц» для цели (D93): сколько ей достаётся по месяцам и что мешает. */
defineSheet('fc-goal', (id) => {
  const st = getState();
  const o = ov();
  const g = o.goals.find((x) => x.id === id);
  if (!g) return null;
  const rs = runForecast(st, today());
  const base = rs.find((r) => r.scenarioId === 'base') ?? rs[0];
  if (!base) return null;
  const kids = o.goals.filter((x) => x.parentId === g.id && x.status !== 'cancelled');
  const reached = base.goalDates[g.id] ?? null;
  const progress = (k: number): number => base.months[k]?.goalProgress[g.id] ?? 0;
  const start = progress(0);
  const allocated: number[] = base.months.map((m) => m.allocated[g.id] ?? 0);
  const until = reached ? base.months.findIndex((m) => m.month === reached) : base.months.length - 1;
  const got = allocated.slice(0, until + 1).filter((v) => v > 0);
  const avg = got.length ? Math.round(got.reduce((s: number, v) => s + v, 0) / Math.max(1, until + 1)) : 0;
  const last = base.months[base.months.length - 1]!.month;
  const lines: (HTMLElement | null)[] = [
    h('p', null, `Нужно ${fmt(g.targetMin)}. ${reached ? `По прогнозу набирается в ${formatMonthRu(reached)}.` : `За прогноз до ${formatMonthRu(last)} не набирается: к концу будет ${fmt(progress(base.months.length - 1) as Money)}.`}`),
    kids.length
      ? h(
          'div',
          { class: 'warnline' },
          `Это общая цель для: ${kids.map((k) => `«${k.title}»`).join(', ')}. Деньги получают только они, а сама «${g.title}» растёт лишь из их сумм — поэтому она не набирается сверх них. Если хочешь, чтобы она копилась сама, убери у этих целей «Часть другой цели».`,
        )
      : null,
    h('p', null, `Сейчас на ней ${fmt(start as Money)}. ${avg > 0 ? `В среднем ей достаётся ${fmt(avg as Money)} в месяц.` : 'Из прироста ей пока ничего не достаётся.'}`),
    !kids.length && avg === 0 && !reached ? h('p', { class: 'muted' }, 'Свободные деньги каждого месяца сначала идут на подушку и на цели со сроком; этой цели не остаётся. Подними её важность или поставь срок.') : null,
    sub('Первые месяцы'),
    rows(
      base.months.slice(0, Math.min(6, base.months.length)).map((m) => row({ title: formatMonthRu(m.month), sub: `накоплено ${fmt((m.goalProgress[g.id] ?? 0) as Money)}`, value: (m.allocated[g.id] ?? 0) > 0 ? `+${fmt((m.allocated[g.id] ?? 0) as Money)}` : '—' })) as HTMLElement[],
    ),
  ];
  return { title: g.title, body: h('div', { class: 'stack' }, ...lines.filter((x): x is HTMLElement => x !== null)) };
});

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
  const betterSame = sameAs(tr.better, tr.base);
  const worseSame = sameAs(tr.worse, tr.base);
  // одно главное число — база; остальные сценарии словами, с объяснением, что они меняют (D93)
  const alt = [worseSame || lo === null ? null : `если будет хуже — ${fmtShort(lo)}`, betterSame || hi === null ? null : `если лучше — ${fmtShort(hi)}`].filter(Boolean).join(' · ');
  root.append(
    h(
      'section',
      { class: 'hero', 'aria-label': `Капитал ${PERIOD_WORDS[period]}` },
      h('div', { class: 'label' }, h('span', null, `Всего у тебя будет ${PERIOD_WORDS[period]}`, info('net'))),
      h('div', { class: `value${(cap(tr.base) ?? 0) < 0 ? ' neg' : ''}` }, cap(tr.base) === null ? '—' : fmtShort(cap(tr.base)!)),
      h('div', { class: 'subline' }, 'если всё пойдёт как сейчас', alt ? ` · ${alt}` : ''),
      h('a', { class: 'link', href: sheetHref('fc-scenarios') }, 'Что значит «хуже» и «лучше» ›'),
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
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Срок'), worseSame ? null : h('th', { scope: 'col' }, 'Хуже'), h('th', { scope: 'col' }, 'База'), betterSame ? null : h('th', { scope: 'col' }, 'Лучше'))),
      h(
        'tbody',
        null,
        horizons.map((m) =>
          h(
            'tr',
            { class: m === k ? 'on' : '' },
            h('th', { scope: 'row' }, m < 12 ? `${m} мес` : m === 12 ? '1 год' : `${m / 12} года`),
            worseSame ? null : h('td', null, short(tr.worse.capitalAfter[m])),
            h('td', null, h('strong', null, short(tr.base.capitalAfter[m]))),
            betterSame ? null : h('td', null, short(tr.better.capitalAfter[m])),
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
    const lastMonth = tr.base.months[tr.base.months.length - 1]?.month;
    // вместо «за горизонтом» — понятно: не успеваешь за срок прогноза (D93)
    const d = (x: MonthKey | null | undefined) => (x ? formatMonthRu(x) : lastMonth ? `позже ${formatMonthRu(lastMonth)}` : 'не успеваешь');
    root.append(
      sub('Когда достигнешь целей', info('goalDate')),
      rows(
        goals.map((g) => {
          const b = tr.base.goalDates[g.id];
          const w = tr.worse.goalDates[g.id];
          const be = tr.better.goalDates[g.id];
          // только сценарии, где дата другая: «лучше: апр» рядом с базой «апр» — шум (D93)
          const alts = [be !== b ? `лучше: ${d(be)}` : null, w !== b ? `хуже: ${d(w)}` : null].filter(Boolean).join(' · ');
          return row({ title: g.title, sub: alts || 'почему этот месяц ›', value: d(b), href: sheetHref('fc-goal', g.id) });
        }),
      ),
    );
  }

  // проверить решение
  root.append(
    sub('А что если…'),
    rows(
      row({ title: 'Запланировать событие', sub: 'то, что точно будет: новая работа, крупная покупка, аренда — войдёт в прогноз', value: st.settings.plannedEvents.length ? String(st.settings.plannedEvents.length) : undefined, href: sheetHref('fc-events') }),
      row({ title: 'Проверить одно решение', sub: 'что изменится, если, например, взять рассрочку', href: sheetHref('fc-whatif') }),
      row({ title: 'Сравнить несколько вариантов', sub: 'два-три плана рядом', href: sheetHref('fc-alt') }),
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
    field('Название', h('input', { name: 'title', required: true, placeholder: 'Аренда, ноутбук, новая работа…', autocomplete: 'off' })),
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
      h('p', { class: 'muted' }, 'То, что точно случится: новая работа, аренда, крупная покупка, конец учёбы. Входит во все сценарии.'),
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
                    return row({ title: goalTitle(id), value: v === null || v === undefined ? 'не успеваешь за срок прогноза' : `${v > 0 ? 'позже' : 'раньше'} на ${Math.abs(v)} мес.` });
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

