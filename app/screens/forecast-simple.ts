/**
 * «Прогноз» (D96): одно число — сколько будет через выбранный срок, если всё пойдёт как сейчас; запас прочности
 * в месяцах; по строке на цель; «Планирую…» — готовые события и своё событие, каждое можно посчитать и добавить в план.
 * График, таблица и сценарии «Хуже / Лучше» — в «График и сценарии».
 */
import { SAVING_CUT_PCT, planToGoal, reorderGoals, applyRepeatAnswer, buildSimInput, savingOptions, cutEvent, debtAfterYear, previewBaselineMode, previewEvent, previewIndexed, capitalAt, classRegistry, listOrder, previewRepeat, runWhatIf, sanityCheck, sparseExpenses, type LifeEvent, type LifeEventKind, type Money, type MonthKey, type WhatIfResult } from '../../engine/index';
import { ask, field, h } from '../dom';
import { act, getState, today, update } from '../store';
import { forecastNow, ov, runwayNow, verdicts } from '../ctx';
import { attention, fmt, fmtDay, fmtShort, monthGen, monthTo, monthWord, newId, nWord, row, rows, seg, stickyBar, sub } from '../ui';
import { closeSheet, defineSheet, refresh, sheetHref } from '../main';
import { explainLink, registerExplain } from '../explain';
import { warningItems } from './forecast';
import { KINDS, PLAN_CHIPS, eventLine } from './plan';

/** Дальше года главное число не показывается (D100): через 2–5 лет жизнь почти наверняка другая — для этого «Планирую…». */
const HORIZONS: [number, string, string][] = [
  [6, 'полгода', 'полгода'],
  [12, 'год', 'год'],
];

/** Траты в прогнозе теми же частями, что на «Обзоре» (D109). */
function spendParts(): HTMLElement | null {
  const st = getState();
  const { input } = buildSimInput(st, today());
  const reg = classRegistry(st.settings.classes);
  const isRare = (k: string) => reg.find((c) => c.id === k)?.behavior === 'irregular';
  const usual = input.expenses.filter((x) => !isRare(x.key)).reduce((a, x) => a + x.monthly, 0) as Money;
  const rare = input.expenses.filter((x) => isRare(x.key)).reduce((a, x) => a + x.monthly, 0) as Money;
  if (usual + rare <= 0) return null;
  return h('a', { class: 'subline', href: sheetHref('explain', 'forecast'), style: 'color:inherit;display:block' }, `Траты в месяц: обычные ${fmtShort(usual)}${rare > 0 ? ` + редкие ${fmtShort(rare)}` : ''} ›`);
}

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
    // одна раскладка с «Обзором» (D109): обычные — как «обычно уходит», редкие — отдельно
    ...(() => {
      const reg = classRegistry(st.settings.classes);
      const isRare = (k: string) => reg.find((c) => c.id === k)?.behavior === 'irregular';
      const lineOf = (x: (typeof input.expenses)[number]) => { const [t0, how] = x.title.split(' ('); const t = x.key === 'E_base' ? 'Повседневное' : t0!.replace(/^Расход:\s*/, '').replace(/^./, (c) => c.toUpperCase()); return line(t, x.monthly, [how ? how.replace(/\)$/, '') : '', x.end ? `до ${dmy(x.end)}` : ''].filter(Boolean).join(' · ') || undefined); };
      const usual = input.expenses.filter((x) => !isRare(x.key));
      const rare = input.expenses.filter((x) => isRare(x.key));
      const total = (xs: typeof input.expenses) => xs.reduce((a, x) => a + x.monthly, 0) as Money;
      if (!input.expenses.length) return [sub('Траты в месяц'), h('p', { class: 'muted' }, 'не размечены')];
      return [
        sub('Обычные траты в месяц'),
        rows(usual.map(lineOf), row({ title: h('strong', null, 'Обычные'), value: h('strong', null, fmt(total(usual))) })),
        rare.length ? [sub('Редкие траты в месяц'), rows(rare.map(lineOf), row({ title: h('strong', null, 'Редкие'), value: h('strong', null, fmt(total(rare))) }))] : null,
        rows(row({ title: h('strong', null, 'Всего траты'), value: h('strong', null, fmt(spend as Money)) })),
      ];
    })(),
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
  // долг дольше года и заметный (не меньше месячных трат и 10 000 ₸): иначе «через год» и «на счетах» отличаются на копейки
  const debtRaw = debtAfterYear(st, today());
  const debtLeft = (debtRaw >= Math.max(ov().spend.usualMonthly, 1_000_000) ? debtRaw : 0) as Money;
  const word = HORIZONS.find(([m]) => m === k)?.[2] ?? `${k} мес.`;
  root.append(
    horizonSeg(k),
    h(
      'section',
      { class: 'hero', 'aria-label': 'Прогноз' },
      h('div', { class: 'label' }, `Через ${word} у тебя будет`),
      h('div', { class: `value${(cap ?? 0) < 0 ? ' neg' : ''}` }, cap === null ? '—' : fmtShort(cap)),
      h('div', { class: 'subline' }, 'если всё пойдёт так же, как сейчас. Дальше года — добавь свои планы в «Планирую…»'),
      // долг дольше года: «через год» — за вычетом долга, и это нужно сказать, иначе сравнивают с «На руках» (D114, С6)
      debtLeft > 0 ? h('div', { class: 'subline' }, `Это за вычетом долга: через год ты ещё должен ${fmtShort(debtLeft)}, на счетах будет примерно ${fmtShort(((cap ?? 0) + debtLeft) as Money)}.`) : null,
      h('div', { class: 'subline' }, rwText),
      spendParts(),
    ),
  );
  if (sim.gaps.length) root.append(h('div', { class: 'badline' }, `Денег не хватит с ${fmtDay(sim.gaps[0]!.start)}: до ${fmt(sim.gaps[0]!.maxDeficit)}`));
  // проверка здравого смысла (D107): допущения, которые меняют вывод, — на виду, а не в «Как посчитано»
  // проверка здравого смысла (D107, D108): сначала вопросы, на которые человек может ответить, потом допущения
  const found = sanityCheck(st, today()).findings;
  const drops = found.filter((f) => f.id === 'income_drop_flat_spend' && f.level === 'fail' && f.ref);
  for (const f of drops) root.append(dropCard(f.text, f.months![0]!, f.ref!));
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
          (() => {
            const pv = previewIndexed(st, today(), x.id, 36);
            return h(
              'div',
              { class: 'stack' },
              h('span', null, `${x.title} · ${fmt(x.amount)}`),
              pv.yes !== null && pv.no !== null ? h('div', { class: 'muted' }, `Через 3 года: если повышают — ${fmtShort(pv.yes)}, если нет — ${fmtShort(pv.no)}.`) : null,
              h('div', { class: 'chips wrap' }, h('button', { class: 'chip', type: 'button', onclick: () => setIdx(x.id, true) }, 'Да, вместе с ценами'), h('button', { class: 'chip', type: 'button', onclick: () => setIdx(x.id, false) }, 'Нет')),
            );
          })(),
        ),
      ),
    );
  }
  const short = found.find((f) => f.id === 'labels_exceed_money' && f.level === 'fail');
  if (short) {
    root.append(h('section', { class: 'warnline stack', 'aria-label': 'Не хватит денег' }, h('strong', null, short.text), h('div', { class: 'chips wrap' }, h('a', { class: 'chip', href: sheetHref('fc-draw', '') }, 'Выбрать цели'))));
  }
  // траты взяты за месяцы с другим доходом (D113): предложить считать по месяцам без зарплаты
  const bPv = found.some((f) => f.id === 'baseline_other_income') ? previewBaselineMode(st, today(), 12) : null;
  {
    const pv = bPv;
    if (pv) {
      const set = (mode: 'last' | 'no_work') => void act((x) => ({ ...x, settings: { ...x.settings, baselineMode: mode } }), mode === 'no_work' ? 'Обычные траты — по месяцам без зарплаты' : 'Обычные траты — по последним месяцам');
      root.append(
        h(
          'section',
          { class: 'warnline stack', 'aria-label': 'Траты и зарплата' },
          h('strong', null, 'Обычные траты сейчас считаются в том числе по месяцам, когда была зарплата, а её больше нет. Считать по месяцам без зарплаты?'),
          h('div', null, `Обычно уходит: ${fmt(pv.usualNow)} → ${fmt(pv.usualNoWork)} в месяц (по ${nWord(pv.months, 'месяцу', 'месяцам', 'месяцам')} без работы).`),
          pv.capitalNow !== null && pv.capitalNoWork !== null ? h('div', null, `Через год: ${fmtShort(pv.capitalNow)} → ${fmtShort(pv.capitalNoWork)}.`) : null,
          h('div', { class: 'chips wrap' }, h('button', { class: 'chip', type: 'button', onclick: () => set('no_work') }, 'Да, без зарплаты'), h('button', { class: 'chip', type: 'button', onclick: () => set('last') }, 'Нет, как сейчас')),
        ),
      );
    }
  }
  // редкие траты (1–2 за год), которые прогноз раскладывает на каждый месяц, — спросить, повторятся ли (D110)
  const sparse = sparseExpenses(st, today(), ov());
  if (sparse.length) {
    root.append(
      h(
        'section',
        { class: 'warnline stack', 'aria-label': 'Редкие траты' },
        h('strong', null, 'Эти траты были 1–2 раза за год, а прогноз тратит их каждый месяц. Повторятся?'),
        rows(sparse.slice(0, 3).map((x) => row({ title: x.title, sub: `${nWord(x.count, 'трата', 'траты', 'трат')} за год на ${fmt(x.total)} · в прогнозе ≈ ${fmt(x.monthly)} в месяц`, href: sheetHref('oneoff-q', x.categoryId) }))),
        sparse.length > 3 ? h('p', { class: 'muted' }, `Ещё ${sparse.length - 3} — после этих.`) : null,
      ),
    );
  }
  // порядок — по важности: что меняет вывод сильнее, то выше
  const ORDER = ['income_drop_flat_spend', 'negative_months', 'cushion_ignores_money', 'labels_exceed_money', 'one_sided_inflation', 'baseline_other_income', 'expense_mismatch'];
  const sane = found
    .filter((f) => ORDER.includes(f.id) && !drops.includes(f) && f !== infl && f !== short && !(bPv && f.id === 'baseline_other_income'))
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
          const drawn = sim.drawnFrom[g.id];
          const base2 = pct !== null && pct >= 1 ? `наберётся ${fmtShort(partial as Money)} из ${fmtShort(g.targetMin)} к ${monthTo(lastMonth!)}` : subText;
          // из цели придётся взять при нехватке — сказать на строке (D109)
          const sub2 = drawn ? [base2, `с ${monthGen(drawn.from)} из неё уйдёт ${fmtShort(drawn.total)}`].filter(Boolean).join(' · ') : base2;
          return row({ title: g.title, sub: sub2, value, href: sheetHref('fc-goal', g.id) });
        }),
      ),
    );
  }

  {
    const order = (st.settings.drawOrder ?? []).map((id) => ov().goals.find((g) => g.id === id)?.title).filter(Boolean);
    root.append(rows(row({ title: 'Если денег не хватит', sub: order.length ? `брать из: ${order.map((t) => `«${t}»`).join(', ')}` : 'сначала свободные деньги, потом — не выбрано', href: sheetHref('fc-draw', '') })));
  }
  root.append(
    rows(row({ title: 'Из А в Б', sub: 'скажи, к какому сроку что нужно, — посчитаю, что для этого изменить', href: sheetHref('a-to-b') })),
    rows(row({ title: 'Где можно сэкономить', sub: 'на чём уходит больше всего и что даст, если там тратить меньше', href: sheetHref('save-where') })),
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


/**
 * «Если денег не хватит» (D109): из каких целей брать, когда свободные деньги кончились, — по порядку, который выбирает человек.
 * Объяснение — на его собственных цифрах из прогноза, а не абстрактно.
 */
defineSheet('fc-draw', () => {
  const st = getState();
  const o = ov();
  const sim = forecastNow();
  const order = st.settings.drawOrder ?? [];
  const free = Math.max(0, o.spend.onHand - o.fundings.reduce((a, f) => a + f.amount, 0)) as Money;
  const negMonths = sim.months.slice(1).filter((m) => m.income - m.expenses - m.obligations - m.events < 0);
  const negSum = negMonths.reduce((a, m) => a + (m.expenses + m.obligations + m.events - m.income), 0) as Money;
  const example = negMonths.length
    ? `По прогнозу с ${monthGen(negMonths[0]!.month)} траты больше дохода — всего на ${fmt(negSum)} за ${nWord(negMonths.length, 'месяц', 'месяца', 'месяцев')}. Сначала на это уйдут свободные деньги — те, что не закреплены ни за одной целью (сейчас ${fmt(free)}).${sim.overAssignedFrom || Object.keys(sim.drawnFrom).length ? ' Их не хватит — остальное придётся взять из накоплений на цели.' : ' Их хватит — цели не пострадают.'}`
    : `Например: если в каком-то месяце траты окажутся на 20 000 ₸ больше дохода, сначала уйдут свободные деньги — те, что не закреплены ни за одной целью (сейчас ${fmt(free)}). Когда они кончатся — деньги отмеченных ниже целей.`;
  const goals = listOrder(o.goals).filter((g) => g.status === 'active' && !g.folder);
  const toggle = (id: string) =>
    void act((x) => {
      const cur = x.settings.drawOrder ?? [];
      return { ...x, settings: { ...x.settings, drawOrder: cur.includes(id) ? cur.filter((y) => y !== id) : [...cur, id] } };
    }, order.includes(id) ? 'Из этой цели брать не будем' : 'Отмечено: брать, если не хватит');
  return {
    title: 'Если денег не хватит',
    body: h(
      'div',
      { class: 'stack' },
      h('p', null, example),
      h('p', { class: 'muted' }, 'Отметь цели, из которых можно брать, — в том порядке, в каком готов их тратить: первая отмеченная тратится первой. Это только для прогноза: приложение ничего не переводит и сами цели не меняет.'),
      rows(
        goals.map((g) => {
          const i = order.indexOf(g.id);
          const have = o.fundings.filter((f) => f.goalId === g.id).reduce((a, f) => a + f.amount, 0) as Money;
          return row({
            title: g.title,
            sub: `сейчас за ней ${fmt(have)}`,
            value: h('span', { class: i >= 0 ? 'chip on' : 'chip' }, i >= 0 ? `${i + 1}-я` : 'не брать'),
            onClick: () => toggle(g.id),
          });
        }),
      ),
      order.length ? null : h('p', { class: 'muted' }, 'Пока ничего не отмечено — прогноз не трогает цели и показывает, что за ними числится больше, чем будет денег.'),
    ),
  };
});

/** «Повторится ли эта трата?» (D110): предпросмотр — как изменится капитал через год при каждом ответе. */
defineSheet('oneoff-q', (catId) => {
  const st = getState();
  const x = sparseExpenses(st, today(), ov()).find((e) => e.categoryId === catId);
  if (!x) return null;
  const pv = previewRepeat(st, today(), catId, 12);
  const diff = pv.now !== null && pv.ifNever !== null ? ((pv.ifNever - pv.now) as Money) : null;
  const answer = (a: 'never' | 'repeat') =>
    void act((s) => applyRepeatAnswer(s, catId, a), a === 'never' ? `«${x.title}» — разовая, из прогноза убрана` : `«${x.title}» — повторяется, в прогнозе остаётся`).then(() => closeSheet());
  return {
    title: x.title,
    body: h(
      'div',
      { class: 'stack' },
      h('p', null, `За год: ${nWord(x.count, 'трата', 'траты', 'трат')} на ${fmt(x.total)}, последняя ${fmtDay(x.last)}. Прогноз сейчас считает ≈ ${fmt(x.monthly)} в месяц и каждый год дорожает.`),
      h('strong', null, 'Что изменится через год'),
      rows(
        row({ title: 'Повторяется', sub: 'траты остаются в прогнозе', value: pv.now === null ? '—' : fmtShort(pv.now) }),
        row({ title: 'Разовая', sub: diff !== null && diff > 0 ? `+${fmtShort(diff)} к капиталу` : 'убрать из прогноза', value: pv.ifNever === null ? '—' : fmtShort(pv.ifNever) }),
      ),
      h('p', { class: 'muted' }, 'Если трата бывает раз в несколько месяцев — выбери «Повторяется»: прогноз берёт среднее за год, но не добавляет её в «обычно уходит». Каждый месяц до даты — в «Данные → Раскладка трат».'),
      h('div', { class: 'chips wrap' },
        h('button', { class: 'btn wide', type: 'button', onclick: () => answer('never') }, 'Разовая — больше не повторится'),
        h('button', { class: 'btn wide', type: 'button', onclick: () => answer('repeat') }, 'Повторяется'),
      ),
    ),
  };
});


const monthsText = (m: number): string => `${m > 0 ? 'позже' : 'раньше'} на ${nWord(Math.abs(m), 'месяц', 'месяца', 'месяцев')}`;

/** Строки «цель: было → стало» для предпросмотра. */
function shiftLines(shifts: ReturnType<typeof previewEvent>['shifts']): HTMLElement[] {
  return shifts.slice(0, 4).map((x) => {
    const from = x.from ? monthWord(x.from) : 'не набирается';
    const to = x.to ? monthWord(x.to) : 'не набирается';
    return h('div', null, `${x.title}: ${from} → ${to}${x.months !== null ? ` (${monthsText(x.months)})` : ''}`);
  });
}

/**
 * «Что изменится?» при конце дохода (D108) с предпросмотром (D114): ползунок «Урежу траты» — тянешь, и сразу видно,
 * как меняются капитал через год и даты целей. «Применить» кладёт событие в план, «Ничего не изменится» — ответ без события.
 */
function dropCard(text: string, endMonth: string, incomeId: string): HTMLElement {
  const st = getState();
  const from = `${endMonth}-01`;
  // ползунок в тенге, деньги движка — в тиынах (×100); потолок — половина обычных месячных трат
  const maxTenge = Math.max(10_000, Math.round(ov().spend.usualMonthly / 100 / 2 / 1000) * 1000);
  const slider = h('input', { type: 'range', min: '0', max: String(maxTenge), step: '1000', value: '0', 'aria-label': 'На сколько урезать траты в месяц, ₸' }) as HTMLInputElement;
  const out = h('div', { class: 'stack tight' });
  const apply = h('button', { class: 'btn wide primary', type: 'button', disabled: true }, 'Урежу траты');
  let amount = 0;
  const draw = () => {
    amount = Number(slider.value) * 100;
    const pv = previewEvent(st, today(), amount > 0 ? [cutEvent('preview', from, amount as Money)] : []);
    const c = pv.capital(12);
    const lines: (HTMLElement | null)[] = [
      h('div', null, amount > 0 ? `Урежу на ${fmt(amount as Money)} в месяц с ${monthGen(endMonth)}` : 'Если ничего не менять'),
      c.with !== null ? h('div', null, h('strong', null, `Через год: ${fmtShort(c.with)}`), amount > 0 && c.without !== null ? ` (без этого — ${fmtShort(c.without)})` : '') : null,
      ...(amount > 0 ? (pv.shifts.length ? shiftLines(pv.shifts) : [h('div', { class: 'muted' }, 'Даты целей не меняются')]) : []),
    ];
    out.replaceChildren(...(lines.filter(Boolean) as HTMLElement[]));
    apply.disabled = amount <= 0;
  };
  slider.addEventListener('input', draw);
  apply.addEventListener('click', () => {
    if (amount <= 0) return;
    const ev = cutEvent(newId('ev'), from, amount as Money);
    void act((s) => ({ ...s, settings: { ...s.settings, plannedEvents: [...s.settings.plannedEvents, ev] } }), `Урезаю на ${fmt(amount as Money)} с ${monthGen(endMonth)} — в плане, прогноз пересчитан`);
  });
  draw();
  return h(
    'section',
    { class: 'warnline stack', 'aria-label': 'Доход уменьшится' },
    h('strong', null, text),
    slider,
    out,
    apply,
    h('div', { class: 'chips wrap' },
      h('a', { class: 'chip', href: sheetHref('plan', `job@${from}`) }, 'Будет другой доход'),
      h('button', { class: 'chip', type: 'button', onclick: () => void act((s) => ({ ...s, settings: { ...s.settings, incomeEndsAnswered: [...new Set([...(s.settings.incomeEndsAnswered ?? []), incomeId])] } }), 'Записано: ничего не изменится') }, 'Ничего не изменится'),
    ),
  );
}


/** «Где можно сэкономить» (D116): категории по размеру и динамике, у каждой — цена урезания в целях. */
defineSheet('save-where', () => {
  const r = savingOptions(getState(), today());
  if (!r) return { title: 'Где можно сэкономить', body: h('p', { class: 'muted' }, 'Нужны траты за полный месяц — загрузи бэкап.') };
  const trend = (x: number | null) => (x === null ? '' : x === 0 ? ' · без изменений за полгода' : ` · за полгода ${x > 0 ? '+' : '−'}${Math.abs(x)} %`);
  return {
    title: 'Где можно сэкономить',
    body: h(
      'div',
      { class: 'stack' },
      h('p', null, `В среднем за ${nWord(r.months, 'месяц', 'месяца', 'месяцев')} уходит ${fmt(r.total)} в месяц на траты (без рассрочек). Вот на чём больше всего — и что даст, если тратить меньше. Это варианты, выбираешь ты.`),
      rows(
        r.options.map((x) =>
          row({
            title: x.title,
            sub: `${fmt(x.monthly)} в месяц · ${Math.round(x.share * 100)} % трат${trend(x.trendPct)}`,
            value: x.cut ? h('span', { class: 'good' }, `−${SAVING_CUT_PCT} % → +${fmtShort(x.cut.capitalGain12)}`) : undefined,
            href: sheetHref('save-cat', x.categoryId),
          }),
        ),
      ),
      h('p', { class: 'muted' }, `Справа — сколько прибавится к капиталу за год, если на этой статье тратить на ${SAVING_CUT_PCT} % меньше. Нажми на статью, чтобы подвигать ползунок.`),
    ),
  };
});

defineSheet('save-cat', (catId) => {
  const st = getState();
  const r = savingOptions(st, today());
  const x = r?.options.find((o) => o.categoryId === catId);
  if (!x) return null;
  const from = `${monthKeyNext(today())}-01`;
  const slider = h('input', { type: 'range', min: '0', max: String(Math.max(1000, Math.round((x.monthly / 100) / 2 / 1000) * 1000)), step: '500', value: String(Math.round(x.monthly / 100 / 5 / 500) * 500), 'aria-label': 'На сколько тратить меньше в месяц, ₸' }) as HTMLInputElement;
  const out = h('div', { class: 'stack tight' });
  const apply = h('button', { class: 'btn wide primary', type: 'button' }, 'Добавить в план');
  let amount = 0;
  const draw = () => {
    amount = Number(slider.value) * 100;
    if (amount <= 0) {
      out.replaceChildren(h('div', { class: 'muted' }, 'Подвинь ползунок — увидишь, что изменится.'));
      apply.disabled = true;
      return;
    }
    const pv = previewEvent(st, today(), [cutEvent('preview', from as never, amount as Money)]);
    const c = pv.capital(12);
    out.replaceChildren(
      h('div', null, h('strong', null, `Тратить на ${fmt(amount as Money)} меньше в месяц`), ` (${Math.round((amount / x.monthly) * 100)} % статьи)`),
      ...(c.with !== null && c.without !== null ? [h('div', null, `Через год: ${fmtShort(c.with)} вместо ${fmtShort(c.without)}`)] : []),
      ...(pv.shifts.length ? shiftLines(pv.shifts) : [h('div', { class: 'muted' }, 'Даты целей не меняются')]),
    );
    apply.disabled = false;
  };
  slider.addEventListener('input', draw);
  apply.addEventListener('click', () => {
    if (amount <= 0) return;
    const ev = cutEvent(newId('ev'), from as never, amount as Money, `Меньше: ${x.title}`);
    void act((s) => ({ ...s, settings: { ...s.settings, plannedEvents: [...s.settings.plannedEvents, ev] } }), `«${x.title}»: тратить на ${fmt(amount as Money)} меньше — в плане, прогноз пересчитан`).then(() => closeSheet());
  });
  draw();
  return {
    title: x.title,
    body: h(
      'div',
      { class: 'stack' },
      h('p', null, `Сейчас ${fmt(x.monthly)} в месяц, ${Math.round(x.share * 100)} % трат.`),
      slider,
      out,
      apply,
      h('p', { class: 'muted' }, 'В план попадёт как «Меньше: …» с первого числа следующего месяца; убрать можно на «Прогнозе» в разделе «В плане».'),
    ),
  };
});

function monthKeyNext(t: string, ahead = 0): string {
  const [y, m] = t.slice(0, 7).split('-').map(Number) as [number, number];
  const n = y * 12 + m + ahead;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
}


// ───────────────────────── «Из А в Б» (D117) ─────────────────────────

let routeGoal: string | null = null;
let routeBy: string | null = null;

defineSheet('a-to-b', () => {
  const st = getState();
  const goals = listOrder(ov().goals).filter((g) => g.status === 'active' && !g.folder);
  if (!goals.length) return { title: 'Из А в Б', body: h('p', { class: 'muted' }, 'Сначала заведи цель на «Целях» — например, подушку.') };
  const t = today();
  const goal = goals.find((g) => g.id === routeGoal) ?? goals[0]!;
  const months: string[] = [];
  for (let i = 1; i <= 36; i++) months.push(monthKeyNext(t, i - 1));
  const by = (routeBy && months.includes(routeBy) ? routeBy : goal.deadline && months.includes(goal.deadline.slice(0, 7)) ? goal.deadline.slice(0, 7) : months[11]!) as MonthKey;
  const nm = (g: (typeof goals)[number]) => (g.role === 'safety' && g.parentId === undefined ? 'Подушка' : g.title);
  const selGoal = h('select', { 'aria-label': 'Цель' }, goals.map((g) => h('option', { value: g.id, selected: g.id === goal.id ? true : undefined }, nm(g)))) as HTMLSelectElement;
  const selBy = h('select', { 'aria-label': 'К какому месяцу' }, months.map((m) => h('option', { value: m, selected: m === by ? true : undefined }, monthWord(m as MonthKey)))) as HTMLSelectElement;
  selGoal.addEventListener('change', () => ((routeGoal = selGoal.value), (routeBy = null), refresh()));
  selBy.addEventListener('change', () => ((routeBy = selBy.value), refresh()));
  const r = planToGoal(st, t, goal.id, by);
  const out: (HTMLElement | null)[] = [];
  if (r) {
    const f = r.levers.freeSavings;
    out.push(
      r.onTrack
        ? h('div', { class: 'advice' }, h('strong', null, 'Успеваешь'), h('p', null, `К ${monthTo(by)} по прогнозу будет ${fmt(r.progressAtBy)} из ${fmt(r.target)}${r.reachMonth ? `, набирается к ${monthTo(r.reachMonth)}` : ''}. Менять ничего не нужно.`))
        : h(
            'div',
            { class: 'warnline stack tight' },
            h('strong', null, 'Не успеваешь'),
            h('p', null, `К ${monthTo(by)} по прогнозу будет ${fmt(r.progressAtBy)} из ${fmt(r.target)} — не хватает ${fmt(r.missing)}.`),
            h('p', null, r.reachMonth ? `Как сейчас — к ${monthTo(r.reachMonth)}${r.lateMonths ? ` (позже на ${nWord(r.lateMonths, 'месяц', 'месяца', 'месяцев')})` : ''}.` : 'Как сейчас — не набирается за срок прогноза.'),
          ),
    );
    if (!r.onTrack) {
      {
        out.push(sub('Что можно сделать'));
        const lv = r.levers;
        if (lv.perMonth !== null) {
          const per = lv.perMonth as Money;
          const share = lv.perMonthShareOfSpend !== null ? ` (${Math.round(lv.perMonthShareOfSpend * 100)} % обычных трат)` : '';
          out.push(
            h(
              'div',
              { class: 'card stack tight' },
              h('strong', null, `Тратить меньше или получать больше — на ≈ ${fmt(per)} в месяц`),
              h('p', { class: 'muted' }, `Это ${share ? share.trim() : 'сумма'} со следующего месяца. Для денежного потока всё равно: меньше потратить или больше получить.`),
              h('button', { class: 'btn wide', type: 'button', onclick: () => void act((x) => ({ ...x, settings: { ...x.settings, plannedEvents: [...x.settings.plannedEvents, cutEvent(newId('ev'), `${monthKeyNext(t)}-01` as never, per, `К «${r.title}» к ${monthTo(by)}`)] } }), `В плане: на ${fmt(per)} в месяц больше, чтобы успеть к «${r.title}»`) }, 'Добавить в план'),
            ),
          );
        } else {
          out.push(h('div', { class: 'card' }, h('strong', null, 'Тратить меньше — не поможет'), h('p', { class: 'muted' }, 'Даже без обычных трат к этому сроку не набрать. Выбери срок позже или другой рычаг.')));
        }
        if (lv.reorder) {
          const ro = lv.reorder;
          out.push(
            h(
              'div',
              { class: 'card stack tight' },
              h('strong', null, `Поставить «${r.title}» первой в списке целей`),
              h('p', null, ro.month ? `Тогда она наберётся к ${monthTo(ro.month)}${ro.reaches ? ' — успеваешь' : ' — всё равно позже срока'}.` : 'Тогда она всё равно не набирается за срок прогноза.'),
              ro.shifts.length ? h('div', { class: 'stack tight' }, h('span', { class: 'muted' }, 'Что получат остальные:'), ...shiftLines(ro.shifts)) : h('p', { class: 'muted' }, 'Другие цели не сдвинутся.'),
              h('button', { class: 'btn wide', type: 'button', onclick: () => {
                const ids = [goal.id, ...goals.filter((g) => g.id !== goal.id).map((g) => g.id)];
                void act((x) => ({ ...x, goals: reorderGoals(x.goals, ids) }), `«${r.title}» — первая в списке`);
              } }, 'Поставить первой'),
            ),
          );
        }
        if (f.available > 0) {
          out.push(
            h(
              'a',
              { class: 'card stack tight', href: sheetHref('distribute'), style: 'color:inherit;text-decoration:none' },
              h('strong', null, `В копилках лежит ${fmt(f.available)}, ни за чем не закреплено`),
              h('p', null, `Это закрывает ${fmt(f.covers)} из недостающих ${fmt(r.missing)}. Распределить по порядку списка ›`),
            ),
          );
        }
        if (r.reachMonth) out.push(h('div', { class: 'card' }, h('strong', null, `Или сдвинуть срок на ${monthWord(r.reachMonth)}`), h('p', { class: 'muted' }, 'Как сейчас, без изменений, цель набирается к этому месяцу.')));
      }
    }
  }
  return {
    title: 'Из А в Б',
    body: h(
      'div',
      { class: 'stack' },
      h('p', null, 'Выбери цель и месяц, к которому она должна быть набрана, — посчитаю, чего не хватает и чем это можно закрыть. Ничего не меняется, пока не нажмёшь кнопку.'),
      field('Цель', selGoal),
      field('К какому месяцу', selBy),
      ...(r ? out.filter(Boolean) as HTMLElement[] : [h('p', { class: 'muted' }, 'Для расчёта нужны загруженные данные и месяц в будущем.')]),
    ),
  };
});
