/**
 * «Прогноз» (D96): одно число — сколько будет через выбранный срок, если всё пойдёт как сейчас; запас прочности
 * в месяцах; по строке на цель; «Планирую…» — готовые события и своё событие, каждое можно посчитать и добавить в план.
 * График, таблица и сценарии «Хуже / Лучше» — в «График и сценарии».
 */
import { buildSimInput, capitalAt, listOrder, runWhatIf, sanityCheck, type LifeEvent, type LifeEventKind, type Money, type MonthKey, type WhatIfResult } from '../../engine/index';
import { ask, h } from '../dom';
import { act, getState, today, update } from '../store';
import { forecastNow, ov, runwayNow, verdicts } from '../ctx';
import { attention, fmt, fmtDay, fmtShort, monthGen, monthWord, nWord, row, rows, seg, stickyBar, sub } from '../ui';
import { closeSheet, defineSheet, refresh, sheetHref } from '../main';
import { explainLink, registerExplain } from '../explain';
import { warningItems } from './forecast';
import { KINDS, PLAN_CHIPS, eventLine } from './plan';

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
      h('div', { class: 'subline' }, 'если всё пойдёт так же, как сейчас. Дальше года — добавь свои планы в «Планирую…»'),
      h('div', { class: 'subline' }, rwText),
    ),
  );
  if (sim.gaps.length) root.append(h('div', { class: 'badline' }, `Денег не хватит с ${fmtDay(sim.gaps[0]!.start)}: до ${fmt(sim.gaps[0]!.maxDeficit)}`));
  // проверка здравого смысла (D107): допущения, которые меняют вывод, — на виду, а не в «Как посчитано»
  // проверка здравого смысла (D107, D108): сначала вопросы, на которые человек может ответить, потом допущения
  const found = sanityCheck(st, today()).findings;
  const drops = found.filter((f) => f.id === 'income_drop_flat_spend' && f.level === 'fail' && f.ref);
  for (const f of drops) {
    const from = `${f.months![0]}-01`;
    root.append(
      h(
        'section',
        { class: 'warnline stack', 'aria-label': 'Доход уменьшится' },
        h('strong', null, f.text),
        h('div', { class: 'chips wrap' },
          h('a', { class: 'chip', href: sheetHref('plan', `cut@${from}`) }, 'Урежу траты'),
          h('a', { class: 'chip', href: sheetHref('plan', `job@${from}`) }, 'Будет другой доход'),
          h('button', { class: 'chip', type: 'button', onclick: () => void act((s) => ({ ...s, settings: { ...s.settings, incomeEndsAnswered: [...new Set([...(s.settings.incomeEndsAnswered ?? []), f.ref!])] } }), 'Записано: ничего не изменится') }, 'Ничего не изменится'),
        ),
      ),
    );
  }
  const infl = found.find((f) => f.id === 'one_sided_inflation' && f.level === 'fail' && f.ref);
  if (infl) {
    const ids = new Set(infl.ref!.split(','));
    const setIdx = (id: string, v: boolean) => void act((s) => ({ ...s, settings: { ...s.settings, incomeSchedule: s.settings.incomeSchedule.map((x) => (x.id === id ? { ...x, indexed: v } : x)) } }), v ? 'Доход будет расти вместе с ценами' : 'Доход не растёт');
    root.append(
      h(
        'section',
        { class: 'warnline stack', 'aria-label': 'Рост доходов' },
        h('strong', null, `Траты в прогнозе дорожают на ${(st.settings.inflationBp / 100).toString().replace('.', ',')} % в год. Эти доходы повышают каждый год?`),
        ...st.settings.incomeSchedule.filter((x) => ids.has(x.id)).map((x) =>
          h('div', { class: 'stack' }, h('span', null, `${x.title} · ${fmt(x.amount)}`), h('div', { class: 'chips wrap' }, h('button', { class: 'chip', type: 'button', onclick: () => setIdx(x.id, true) }, 'Да, вместе с ценами'), h('button', { class: 'chip', type: 'button', onclick: () => setIdx(x.id, false) }, 'Нет'))),
        ),
      ),
    );
  }
  // порядок — по важности: что меняет вывод сильнее, то выше
  const ORDER = ['income_drop_flat_spend', 'negative_months', 'cushion_ignores_money', 'labels_exceed_money', 'one_sided_inflation', 'baseline_other_income', 'expense_mismatch', 'oneoff_averaged'];
  const sane = found
    .filter((f) => ORDER.includes(f.id) && !drops.includes(f) && f !== infl)
    .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  if (sane.length) {
    const top = sane.slice(0, 3);
    const rest = sane.slice(3);
    root.append(
      h(
        'section',
        { class: 'warnline stack', 'aria-label': 'Проверь допущения' },
        h('strong', null, 'Проверь, прежде чем верить прогнозу'),
        ...top.map((f) => h('div', null, f.text)),
        rest.length ? h('details', null, h('summary', null, `ещё ${rest.length}`), h('div', { class: 'stack' }, ...rest.map((f) => h('div', null, f.text)))) : null,
      ),
    );
  }

  const vd = verdicts();
  const lastMonth = sim.months[sim.months.length - 1]?.month;
  const when = (x: MonthKey | null | undefined) => (x ? monthWord(x) : lastMonth ? `позже ${monthGen(lastMonth)}` : '—');
  // порядок — тот же, по которому раздаются деньги (D107: раньше подушка ставилась первой только на экране)
  const goals = listOrder(ov().goals).filter((g) => g.status === 'active' && !g.folder && g.id in sim.goalDates);
  const lastProgress = sim.months[sim.months.length - 1]?.goalProgress ?? {};
  if (goals.length) {
    root.append(
      sub('Цели'),
      rows(
        goals.map((g) => {
          const v = vd.get(g.id);
          const cushion = g.role === 'safety' && g.parentId === undefined;
          const subText = v ? (v.ok ? 'успеваешь' : `к сроку ${fmtDay(v.deadline)} не успеваешь`) : cushion ? 'подушка' : g.deadline ? undefined : 'без срока';
          const date = sim.goalDates[g.id];
          // не набирается за прогноз — сколько наберётся, а не «позже …» (D107)
          const partial = date === null && lastMonth ? (lastProgress[g.id] ?? 0) : null;
          const pct = partial !== null && partial > 0 && g.targetMin > 0 ? Math.floor((partial * 100) / g.targetMin) : null;
          const value = pct !== null && pct >= 1 ? `${pct} %` : when(date);
          const sub2 = pct !== null && pct >= 1 ? `наберётся ${fmtShort(partial as Money)} из ${fmtShort(g.targetMin)} к ${monthGen(lastMonth!)}` : subText;
          return row({ title: g.title, sub: sub2, value, href: sheetHref('fc-goal', g.id) });
        }),
      ),
    );
  }

  root.append(
    sub('Планирую…'),
    h('p', { class: 'one-line' }, 'Что изменится, если… Выбери событие — посчитаю, в план попадёт только по кнопке.'),
    h('div', { class: 'chips wrap' }, [...PLAN_CHIPS.map((k) => h('a', { class: 'chip', href: sheetHref('plan', k) }, KINDS[k].label)), h('a', { class: 'chip', href: sheetHref('plan', 'own') }, 'Другое…')]),
  );
  if (st.settings.plannedEvents.length) {
    root.append(
      sub('В плане'),
      rows(
        st.settings.plannedEvents.map((e) =>
          row({
            title: e.title,
            sub: eventLine(e),
            value: h('span', { class: 'chip' }, 'Убрать'),
            onClick: async () => {
              const i = await ask({ title: `Убрать «${e.title}» из плана?`, text: 'Прогноз пересчитается без этого события.', actions: [{ label: 'Убрать', kind: 'danger' }] });
              if (i === 0) await act((s) => ({ ...s, settings: { ...s.settings, plannedEvents: s.settings.plannedEvents.filter((x) => x.id !== e.id) } }), `«${e.title}» убрано из плана`);
            },
            chevron: false,
          }),
        ),
      ),
    );
  }
  const att = attention(items);
  if (att) root.append(att);
  root.append(rows(row({ title: 'Если станет хуже или лучше', sub: 'что будет, если станет хуже или лучше', href: '#/forecast-more' })), explainLink('forecast', 'Из чего прогноз'));
  return root;
}

