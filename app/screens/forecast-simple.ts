/**
 * «Прогноз» (D96): одно число — сколько будет через выбранный срок, если всё пойдёт как сейчас; запас прочности
 * в месяцах; по строке на цель; «Планирую…» — готовые события и своё событие, каждое можно посчитать и добавить в план.
 * График, таблица и сценарии «Хуже / Лучше» — в «График и сценарии».
 */
import { buildSimInput, capitalAt, listOrder, runWhatIf, type LifeEvent, type LifeEventKind, type Money, type MonthKey, type WhatIfResult } from '../../engine/index';
import { ask, h } from '../dom';
import { act, getState, today, update } from '../store';
import { forecastNow, ov, runwayNow, verdicts } from '../ctx';
import { attention, fmt, fmtDay, fmtShort, monthGen, monthWord, nWord, row, rows, seg, stickyBar, sub } from '../ui';
import { closeSheet, defineSheet, refresh, sheetHref } from '../main';
import { explainLink, registerExplain } from '../explain';
import { eventForm, eventRow, warningItems } from './forecast';

/** Дальше года главное число не показывается (D100): через 2–5 лет жизнь почти наверняка другая — для этого «Планирую…». */
const HORIZONS: [number, string, string][] = [
  [6, 'полгода', 'полгода'],
  [12, 'год', 'год'],
];

/** «Как посчитано» прогноза (D100): из чего он сложен — строками, без сплошного текста. */
registerExplain('forecast', 'Из чего прогноз', () => [], () => {
  const st = getState();
  const { input } = buildSimInput(st, today());
  const line = (title: string, value: Money, subText?: string) => row({ title, value: fmt(value), ...(subText ? { sub: subText } : {}) });
  const dmy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
  const byDebt = new Map<string, { title: string; total: number; n: number; last: string }>();
  for (const p of input.payments) {
    const e = byDebt.get(p.obligationId) ?? { title: p.title, total: 0, n: 0, last: p.date };
    e.total += p.amount;
    e.n++;
    e.last = p.date;
    byDebt.set(p.obligationId, e);
  }
  const income = input.incomes.reduce((a, x) => a + x.amount, 0);
  const spend = input.expenses.reduce((a, x) => a + x.monthly, 0);
  return h(
    'div',
    { class: 'stack' },
    h('p', { class: 'muted' }, 'Каждый месяц: доходы − обычные траты − платежи по долгам. Остаток копится и раскладывается по целям — по порядку списка.'),
    sub('Доходы в месяц'),
    input.incomes.length ? rows(input.incomes.map((x) => line(x.title, x.amount, `${x.dayOfMonth}-го${x.end ? ` · до ${dmy(x.end)}` : ''}`)), row({ title: h('strong', null, 'Всего'), value: h('strong', null, fmt(income as Money)) })) : h('p', { class: 'muted' }, 'не заданы'),
    sub('Траты в месяц'),
    input.expenses.length
      ? rows(input.expenses.map((x) => { const [t0, how] = x.title.split(' ('); const t = x.key === 'E_base' ? 'Повседневное' : t0!.replace(/^Расход:\s*/, '').replace(/^./, (c) => c.toUpperCase()); return line(t, x.monthly, [how ? how.replace(/\)$/, '') : '', x.end ? `до ${dmy(x.end)}` : ''].filter(Boolean).join(' · ') || undefined); }), row({ title: h('strong', null, 'Всего'), value: h('strong', null, fmt(spend as Money)) }))
      : h('p', { class: 'muted' }, 'не размечены'),
    byDebt.size ? [sub('Платежи по долгам'), rows([...byDebt.values()].map((d) => line(d.title, d.total as Money, `${nWord(d.n, 'платёж', 'платежа', 'платежей')}, последний ${dmy(d.last)}`)))] : null,
    sub('Деньги сейчас'),
    rows(line('На счетах', input.cash), input.deposits.map((d) => line(d.title, d.balance, d.availableFrom > today() ? `снять можно с ${dmy(d.availableFrom)}` : undefined))),
    sub('Что ещё учтено'),
    rows(
      row({ title: 'Траты дорожают', value: `${(st.settings.inflationBp / 100).toString().replace('.', ',')}% в год` }),
      row({ title: 'Плановые события', value: String(st.settings.plannedEvents.length), href: '#/forecast' }),
    ),
  );
});

const PRESETS: { id: string; label: string; kind: LifeEventKind; title: string }[] = [
  { id: 'job', label: 'Новая работа', kind: 'income_start', title: 'Новая работа' },
  { id: 'study', label: 'Конец учёбы', kind: 'income_stop', title: 'Конец учёбы' },
  { id: 'move', label: 'Переезд', kind: 'recurring_change', title: 'Аренда после переезда' },
  { id: 'buy', label: 'Крупная покупка', kind: 'one_off', title: 'Крупная покупка' },
  { id: 'inst', label: 'Рассрочка', kind: 'recurring_change', title: 'Платёж по рассрочке' },
  { id: 'loss', label: 'Потеря дохода', kind: 'income_stop', title: 'Потеря дохода' },
  { id: 'own', label: 'Своё событие', kind: 'one_off', title: '' },
];

let draft: LifeEvent[] = [];
let result: WhatIfResult | null = null;
let draftPreset = '';

defineSheet('plan', (presetId) => {
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[PRESETS.length - 1]!;
  if (draftPreset !== preset.id) {
    draft = [];
    result = null;
    draftPreset = preset.id;
  }
  const st = getState();
  const k = Math.min(12, st.settings.forecastViewMonths ?? 12);
  const word = HORIZONS.find(([m]) => m === k)?.[2] ?? `${k} мес.`;
  const form = eventForm('plan-form', (e) => {
    draft = [...draft, e];
    const all = runWhatIf(getState(), today(), draft);
    result = all.find((r) => r.scenarioId === 'base') ?? all[0] ?? null;
    refresh();
  }, preset.id === 'own' ? undefined : { kind: preset.kind, title: preset.title });
  const goals = new Map(ov().goals.map((g) => [g.id, g.title]));
  const res = result;
  const delta = res ? (res.with.months[k]?.capital ?? 0) - (res.base.months[k]?.capital ?? 0) : 0;
  const shifted = res ? Object.entries(res.deltaGoalMonths).filter(([, v]) => v !== 0) : [];
  return {
    title: preset.id === 'own' ? 'Своё событие' : preset.label,
    body: h(
      'div',
      { class: 'stack' },
      draft.length ? rows(draft.map((e) => eventRow(e))) : h('p', { class: 'muted' }, 'Заполни и нажми «Посчитать». В план попадёт, только если нажмёшь «Добавить в план».'),
      res
        ? h(
            'div',
            { class: 'card stack' },
            h('strong', null, `Через ${word}: ${delta === 0 ? 'без изменений' : `${delta > 0 ? '+' : '−'}${fmtShort(Math.abs(delta) as never)}`}`),
            shifted.length ? rows(shifted.map(([id, v]) => row({ title: goals.get(id) ?? id, value: v === null ? 'не успеваешь за срок прогноза' : `${v! > 0 ? 'позже' : 'раньше'} на ${nWord(Math.abs(v!), 'месяц', 'месяца', 'месяцев')}` }))) : h('div', { class: 'muted' }, 'Сроки целей не меняются.'),
            res.newGaps.length ? h('div', { class: 'badline' }, `Денег не хватит с ${fmtDay(res.newGaps[0]!.start)}: до ${fmt(res.newGaps[0]!.maxDeficit)}`) : h('div', { class: 'okline' }, 'Денег хватает ✓'),
          )
        : null,
      form,
      h('button', { class: 'btn wide', type: 'submit', form: 'plan-form' }, draft.length ? 'Добавить ещё и посчитать' : 'Посчитать'),
    ),
    bar: stickyBar(
      null,
      h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          disabled: !draft.length,
          onclick: async () => {
            const events = draft;
            draft = [];
            result = null;
            await act((s) => ({ ...s, settings: { ...s.settings, plannedEvents: [...s.settings.plannedEvents, ...events] } }), nWord(events.length, 'событие добавлено', 'события добавлены', 'событий добавлено') + ' в план');
            closeSheet();
          },
        },
        'Добавить в план',
      ),
    ),
  };
});

function horizonSeg(k: number): HTMLElement {
  return seg(HORIZONS.map(([m, l]) => [String(m), l] as const), String(k), (v) => void update((s) => ({ ...s, settings: { ...s.settings, forecastViewMonths: Number(v) } })), 'Срок прогноза');
}

export function renderForecastSimple(_rerender: () => void): HTMLElement {
  const st = getState();
  const root = h('div', { class: 'screen' });
  if (!st.imported) {
    root.append(h('div', { class: 'card stack' }, h('strong', null, 'Сначала загрузи бэкап'), h('p', { class: 'muted' }, 'Прогноз строится по твоим тратам и доходам.'), h('a', { class: 'btn primary wide', href: '#/import' }, 'Загрузить бэкап')));
    return root;
  }
  const { items, missing } = warningItems();
  if (missing.length) {
    root.append(h('div', { class: 'card stack' }, h('strong', null, `Для прогноза нужны: ${missing.map((m) => m.title).join(', ')}`), h('p', { class: 'muted' }, 'Без них прогноз покажет прямую линию — это не прогноз.'), ...missing.map((m, i) => h('a', { class: `btn wide${i === 0 ? ' primary' : ''}`, href: m.href }, m.label))));
    const att = attention(items);
    if (att) root.append(att);
    return root;
  }
  const k = Math.min(12, st.settings.forecastViewMonths ?? 12);
  const sim = forecastNow();
  const cap = capitalAt(sim, k);
  const rw = runwayNow();
  const rwText = rw === null ? 'Если доход пропадёт — денег хватит больше чем на 5 лет.' : rw.months <= 0 ? `Если доход пропадёт — денег не хватит уже в этом месяце.` : `Если доход пропадёт — денег хватит на ${nWord(rw.months, 'месяц', 'месяца', 'месяцев')} (до ${monthGen(rw.until.slice(0, 7))}).`;
  const word = HORIZONS.find(([m]) => m === k)?.[2] ?? `${k} мес.`;
  root.append(
    horizonSeg(k),
    h(
      'section',
      { class: 'hero', 'aria-label': 'Прогноз' },
      h('div', { class: 'label' }, `Через ${word} у тебя будет`),
      h('div', { class: `value${(cap ?? 0) < 0 ? ' neg' : ''}` }, cap === null ? '—' : fmtShort(cap)),
      h('div', { class: 'subline' }, 'если всё пойдёт как сейчас. Дальше года — добавь свои планы в «Планирую…»'),
      h('div', { class: 'subline' }, rwText),
    ),
  );
  if (sim.gaps.length) root.append(h('div', { class: 'badline' }, `Денег не хватит с ${fmtDay(sim.gaps[0]!.start)}: до ${fmt(sim.gaps[0]!.maxDeficit)}`));

  const vd = verdicts();
  const lastMonth = sim.months[sim.months.length - 1]?.month;
  const when = (x: MonthKey | null | undefined) => (x ? monthWord(x) : lastMonth ? `позже ${monthGen(lastMonth)}` : '—');
  const goals = listOrder(ov().goals)
    .filter((g) => g.status === 'active' && !g.folder && g.id in sim.goalDates)
    .sort((a, b) => Number(b.role === 'safety' && b.parentId === undefined) - Number(a.role === 'safety' && a.parentId === undefined));
  if (goals.length) {
    root.append(
      sub('Цели'),
      rows(
        goals.map((g) => {
          const v = vd.get(g.id);
          const cushion = g.role === 'safety' && g.parentId === undefined;
          const subText = v ? (v.ok ? 'успеваешь' : `к сроку ${fmtDay(v.deadline)} не успеваешь`) : cushion ? 'подушка' : g.deadline ? undefined : 'без срока';
          return row({ title: g.title, sub: subText, value: when(sim.goalDates[g.id]), href: sheetHref('fc-goal', g.id) });
        }),
      ),
    );
  }

  root.append(sub('Планирую…'), h('div', { class: 'chips wrap' }, PRESETS.map((p) => h('a', { class: 'chip', href: sheetHref('plan', p.id) }, p.label))));
  if (st.settings.plannedEvents.length) {
    root.append(
      rows(
        st.settings.plannedEvents.map((e) =>
          eventRow(e, async () => {
            const i = await ask({ title: `Убрать «${e.title}» из плана?`, actions: [{ label: 'Убрать', kind: 'danger' }] });
            if (i === 0) await act((s) => ({ ...s, settings: { ...s.settings, plannedEvents: s.settings.plannedEvents.filter((x) => x.id !== e.id) } }), `«${e.title}» убрано`);
          }),
        ),
      ),
    );
  }
  const att = attention(items);
  if (att) root.append(att);
  root.append(rows(row({ title: 'График и таблица по сценариям', sub: 'на 2–3 года, если будет хуже или лучше', href: '#/forecast-more' })), explainLink('forecast', 'Из чего прогноз'));
  return root;
}

