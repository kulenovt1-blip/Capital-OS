/**
 * «Прогноз» (D96): одно число — сколько будет через выбранный срок, если всё пойдёт как сейчас; запас прочности
 * в месяцах; по строке на цель; «Планирую…» — готовые события и своё событие, каждое можно посчитать и добавить в план.
 * График, таблица и сценарии «Хуже / Лучше» — в «График и сценарии».
 */
import { NEVER_AVAILABLE, balanceOn, forecastDate, formatDateRu, stepsTo, SAVING_CUT_PCT, cushionFill, expensePart, higherTargets, routeTo, RESERVE_NOTES, ROUTE_DEADLINES, type ReserveTarget, hiddenFacts, previewAnswer, type SanityFinding, planToGoal, reorderGoals, applyRepeatAnswer, buildSimInput, savingOptions, cutEvent, previewBaselineMode, previewEvent, previewIndexed, capitalAt, classRegistry, listOrder, previewRepeat, runWhatIf, sanityCheck, sparseExpenses, type LifeEvent, type LifeEventKind, type Money, type MonthKey, type WhatIfResult } from '../../engine/index';
import { ask, field, h } from '../dom';
import { act, getState, today, update } from '../store';
import { forecastNow, forecastTraceNow, ov, reserveCtx, verdicts } from '../ctx';
import { attention, fmt, info, fmtDay, fmtShort, monthGen, monthTo, monthWord, newId, nWord, row, rows, seg, stickyBar, sub } from '../ui';
import { closeSheet, defineSheet, refresh, sheetHref } from '../main';
import { explainLink, registerExplain } from '../explain';
import { HORIZONS, warningItems } from './forecast';
import { KINDS, PLAN_CHIPS, eventLine } from './plan';
import { levelShiftLine, futureSummary, futureTrack, plansCount, unknownNote } from '../future';
import { reserveChart } from '../chart';

/** Траты в прогнозе теми же частями, что на «Обзоре» (D109). */
function spendParts(): HTMLElement | null {
  const st = getState();
  const { input } = buildSimInput(st, today());
  const part = (k: string) => expensePart(st, k);
  const usual = input.expenses.filter((x) => part(x.key) === 'usual').reduce((a, x) => a + x.monthly, 0) as Money;
  const rare = input.expenses.filter((x) => part(x.key) === 'rare').reduce((a, x) => a + x.monthly, 0) as Money;
  if (usual + rare <= 0) return null;
  return h('a', { class: 'subline', href: sheetHref('explain', 'forecast'), style: 'color:inherit;display:flex;align-items:center;min-height:44px' }, `Расчёт по шагам · траты в месяц ${fmtShort((usual + rare) as Money)} ›`);
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
    ...(() => {
      // «Расчёт по шагам» (D142): от «на руках сейчас» до итога на дату «сегодня + N мес.» — слагаемыми, как на калькуляторе
      const k = Math.min(12, st.settings.forecastViewMonths ?? 12);
      const tr = forecastTraceNow().trace;
      if (!tr) return [];
      const until = forecastDate(today(), k);
      const group = (key: string) => (expensePart(st, key) === 'rare' ? { id: 'rare', title: 'Редкие траты (доля годовых)' } : { id: 'usual', title: 'Обычные траты' });
      // на длинном сроке повторы (зарплата каждый месяц) сворачиваются в одну строку «× N»; сумма та же
      const full = stepsTo(tr, until, { group });
      const steps = full.lines.length > 14 ? stepsTo(tr, until, { group, collapse: true }) : full;
      const sg = (x: number) => (x < 0 ? '−' : '+');
      const abs = (x: number) => fmt(Math.abs(x) as Money);
      const word = HORIZONS.find(([mm]) => mm === k)?.[2] ?? `${k} мес.`;
      return [
        sub(`Расчёт по шагам: до ${formatDateRu(steps.until)} (через ${word})`, info('forecastSteps')),
        rows(
          row({ title: 'На руках сейчас', sub: 'сумма по всем счетам', value: fmt(steps.from), chevron: false }),
          ...steps.lines.map((l) =>
            row({
              title: `${sg(l.amount)} ${l.date && !(l.count && l.count > 1) ? `${fmtDay(l.date)} ` : ''}${l.title}${l.count && l.count > 1 ? ` × ${l.count}` : ''}`,
              ...(l.count && l.count > 1 && l.date && l.to ? { sub: `с ${fmtDay(l.date)} по ${fmtDay(l.to)}` } : {}),
              ...(l.days !== undefined ? { sub: l.kind === 'interest' ? 'начислено к этой дате' : `за ${nWord(l.days, 'день', 'дня', 'дней')}, каждый день по доле месяца` } : {}),
              value: abs(l.amount),
              chevron: false,
            }),
          ),
          row({ title: h('strong', null, `= На руках ${formatDateRu(steps.until)}`), value: h('strong', null, fmt(steps.total)), chevron: false }),
        ),
        h('p', { class: 'muted' }, 'Сумма строк равна итогу до тиына; на экране суммы округлены до тенге, поэтому на калькуляторе может выйти разница в 1–2 ₸. Доходы и платежи — на своих датах; траты — доля месяца за каждый день срока, поэтому здесь они «по медианам», а не только известные платежи.'),
        steps.liabilities > 0 ? h('p', { class: 'muted' }, `Долги к ${fmtDay(steps.until)}: ещё ${fmt(steps.liabilities)}. Они не вычтены — «капитал» был бы ${fmt((steps.total - steps.liabilities) as Money)}.`) : null,
      ];
    })(),
    h('p', { class: 'muted' }, 'Каждый месяц: доходы − обычные траты − платежи по долгам. Остаток копится и раскладывается по целям — по порядку списка.'),
    sub('Доходы в месяц'),
    input.incomes.length ? rows(input.incomes.map((x) => line(x.title, x.amount, `${x.dayOfMonth}-го${x.end ? ` · до ${dmy(x.end)}` : ''}`)), row({ title: h('strong', null, 'Всего'), value: h('strong', null, fmt(income as Money)) })) : h('p', { class: 'muted' }, 'не заданы'),
    // одна раскладка с «Обзором» (D109): обычные — как «обычно уходит», редкие — отдельно
    ...(() => {
      const part = (k: string) => expensePart(st, k);
      const lineOf = (x: (typeof input.expenses)[number]) => { const [t0, how] = x.title.split(' ('); const t = x.key === 'E_base' ? 'Повседневное' : t0!.replace(/^Расход:\s*/, '').replace(/^./, (c) => c.toUpperCase()); return line(t, x.monthly, [how ? how.replace(/\)$/, '') : '', x.start && x.start > today() ? `с ${dmy(x.start)}` : '', x.end ? `до ${dmy(x.end)}` : ''].filter(Boolean).join(' · ') || undefined); };
      const usual = input.expenses.filter((x) => part(x.key) === 'usual');
      const rare = input.expenses.filter((x) => part(x.key) === 'rare');
      const habit = input.expenses.filter((x) => part(x.key) === 'installments');
      const total = (xs: typeof input.expenses) => xs.reduce((a, x) => a + x.monthly, 0) as Money;
      if (!input.expenses.length) return [sub('Траты в месяц'), h('p', { class: 'muted' }, 'не размечены')];
      return [
        sub('Обычные траты в месяц'),
        rows(usual.map(lineOf), row({ title: h('strong', null, 'Обычные'), value: h('strong', null, fmt(total(usual))) })),
        rare.length ? [sub('Редкие траты в месяц'), rows(rare.map(lineOf), row({ title: h('strong', null, 'Редкие'), value: h('strong', null, fmt(total(rare))) }))] : null,
        habit.length ? [sub('Новые рассрочки — как раньше'), rows(habit.map((x) => line(`${dmy(x.start!)} – ${dmy(x.end!)}`, x.monthly, 'в месяц сверх текущих платежей')))] : null,
        rows(row({ title: h('strong', null, 'Всего траты'), value: h('strong', null, fmt(spend as Money)) })),
      ];
    })(),
    byDebt.size ? [sub('Платежи по долгам'), rows([...byDebt.values()].map((d) => line(d.title, d.total as Money, `${nWord(d.n, 'платёж', 'платежа', 'платежей')}, последний ${dmy(d.last)}`)))] : null,
    sub('Деньги сейчас'),
    rows(line('На счетах', input.cash), input.deposits.map((d) => line(d.title, d.balance, [d.rateBp > 0 ? `${(d.rateBp / 100).toString().replace('.', ',')} % годовых` : '', d.availableFrom === NEVER_AVAILABLE ? 'жильё / заблокировано — не деньги' : d.availableFrom > today() ? `снять можно с ${dmy(d.availableFrom)}` : ''].filter(Boolean).join(' · ') || undefined))),
    sub('Что ещё учтено'),
    rows(
      row({ title: 'Траты дорожают', value: `${(st.settings.inflationBp / 100).toString().replace('.', ',')}% в год` }),
      ...input.incomes.filter((x) => x.growth).map((x) => row({ title: `«${x.title}» повышают`, value: `каждый год в ${['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'][Number((x.growthAnchor ?? x.start ?? today()).slice(5, 7)) - 1]}` })),
      row({ title: 'Плановые события', value: String(st.settings.plannedEvents.length), href: '#/forecast' }),
    ),
  );
});

/**
 * Вопросы о данных, которые прогноз раньше выбрасывал (D119): каждый — на цифрах человека, с ответом в одно касание.
 * Пока нет ответа — прогноз как раньше (без этих данных), и это видно.
 */
function hiddenQuestions(found: SanityFinding[]): { nodes: HTMLElement[]; shown: Set<SanityFinding> } {
  const st = getState();
  const hf = hiddenFacts(st, today(), ov());
  const nodes: HTMLElement[] = [];
  const shown = new Set<SanityFinding>();
  const card = (label: string, title: string, ...body: (HTMLElement | null)[]) => h('section', { class: 'warnline stack', 'aria-label': label }, h('strong', null, title), ...body);
  const chips = (...xs: HTMLElement[]) => h('div', { class: 'chips wrap' }, ...xs);
  const btn = (text: string, fn: () => void) => h('button', { class: 'chip', type: 'button', onclick: fn }, text);
  const pct = (bp: number) => `${(Math.round(bp / 10) / 10).toString().replace('.', ',')} %`;
  // предпросмотр, как у остальных вопросов (D114): что будет через 3 года при «да» и при «нет»
  const pv = (set: (s: typeof st, yes: boolean) => typeof st): HTMLElement | null => {
    const r = previewAnswer(st, today(), set, 36);
    return r.yes !== null && r.no !== null ? h('div', { class: 'muted' }, `Через 3 года: если да — ${fmtShort(r.yes)}, если нет — ${fmtShort(r.no)}`) : null;
  };

  const more = (text: string, ...body: (HTMLElement | null)[]) => h('details', { class: 'fold' }, h('summary', null, text), h('div', { class: 'stack' }, ...body));
  const label = (l: string) => l.replace(/^Расход:\s*/, '').replace(/^./, (c) => c.toUpperCase());

  for (const f of found.filter((x) => x.id === 'interest_ignored' && x.level === 'fail')) {
    const x = hf.interest.find((i) => i.accountId === f.ref);
    if (!x) continue;
    shown.add(f);
    const setRate = (bp: number) => void act((s) => ({ ...s, settings: { ...s.settings, accounts: s.settings.accounts.map((a) => (a.accountId === x.accountId ? { ...a, rateBp: bp } : a)) } }), bp > 0 ? `Проценты по «${x.title}» в прогнозе: ${pct(bp)} годовых` : 'Проценты не считаем');
    nodes.push(card('Проценты', `«${x.title}»: банк начисляет ≈ ${pct(x.suggestedRateBp)} годовых. Считать проценты дальше?`,
      pv((s, yes) => ({ ...s, settings: { ...s.settings, accounts: s.settings.accounts.map((a) => (a.accountId === x.accountId ? { ...a, rateBp: yes ? x.suggestedRateBp : 0 } : a)) } })),
      chips(btn(`Да, ${pct(x.suggestedRateBp)}`, () => setRate(x.suggestedRateBp)), btn('Нет', () => setRate(0))),
      more('Откуда это', h('p', { class: 'muted' }, f.text), h('p', { class: 'muted' }, 'Ставку можно поменять в «Ещё → Счета».'))));
  }
  const lumpsF = found.find((x) => x.id === 'lumps_lost' && x.level === 'fail');
  if (lumpsF) {
    shown.add(lumpsF);
    const ids = new Set(lumpsF.ref!.split(','));
    const setL = (id: string, v: boolean) => void act((s) => ({ ...s, settings: { ...s.settings, lumps: { ...(s.settings.lumps ?? {}), [id]: v } } }), v ? 'Крупные траты будут в прогнозе' : 'Крупные траты не повторятся');
    // по одному вопросу на категорию, а не одна карточка на три
    for (const l of hf.lumps.filter((x) => ids.has(x.classId))) {
      nodes.push(card('Крупные траты', `${label(l.label)}: за год ${fmt(l.total)}, а в обычный месяц ${fmt(l.median)}. Крупные траты повторятся?`,
        pv((s, yes) => ({ ...s, settings: { ...s.settings, lumps: { ...(s.settings.lumps ?? {}), [l.classId]: yes } } })),
        chips(btn(`Да, +${fmtShort(l.extraMonthly)} в месяц`, () => setL(l.classId, true)), btn('Нет, это было разово', () => setL(l.classId, false))),
        more('Какие именно', h('p', { class: 'muted' }, l.top.map((t) => `${fmtDay(t.date)} — ${fmt(t.amount)}${t.comment ? ` (${t.comment})` : ''}`).join('; ')))));
    }
  }
  const habitF = found.find((x) => x.id === 'installment_habit' && x.level === 'fail');
  if (habitF && hf.installments) {
    shown.add(habitF);
    const setH = (v: boolean) => void act((s) => ({ ...s, settings: { ...s.settings, newInstallments: v } }), v ? 'В прогнозе — новые рассрочки, как раньше' : 'Новых рассрочек не будет');
    nodes.push(card('Рассрочки', `Рассрочки были ${hf.installments.monthsWith} мес. из ${hf.installments.months}, в среднем ${fmt(hf.installments.avgMonthly)} в месяц. Будут новые?`,
      pv((s, yes) => ({ ...s, settings: { ...s.settings, newInstallments: yes } })),
      chips(btn('Да, как раньше', () => setH(true)), btn('Нет', () => setH(false))),
      more('Что значит «да»', h('p', { class: 'muted' }, habitF.text), h('p', { class: 'muted' }, 'В прогнозе на рассрочки будет уходить в среднем столько же, как за последний год (вместе с текущими). Конкретную покупку лучше добавить в «Планирую… → Новая рассрочка».'))));
  }
  const incF = found.find((x) => x.id === 'income_omitted' && x.level === 'fail');
  if (incF && hf.extraIncome) {
    shown.add(incF);
    const setI = (v: boolean) => void act((s) => ({ ...s, settings: { ...s.settings, extraIncome: v } }), v ? 'Подарки и прочее — в прогнозе' : 'Подарки и прочее не учитываем');
    nodes.push(card('Подарки и прочие поступления', `Подарки деньгами, кешбэк и прочее — ≈ ${fmt(hf.extraIncome.extraMonthly)} в месяц сверх твоих доходов. Учитывать?`,
      pv((s, yes) => ({ ...s, settings: { ...s.settings, extraIncome: yes } })),
      chips(btn(`Да, +${fmtShort(hf.extraIncome.extraMonthly)} в месяц`, () => setI(true)), btn('Нет', () => setI(false))),
      more('Откуда это', h('p', { class: 'muted' }, incF.text))));
  }
  return { nodes, shown };
}

/** Какой по счёту вопрос показан: «Потом» листает дальше (D121). */
let qSkip = 0;

function horizonSeg(k: number): HTMLElement {
  // С13 аудита UX: «год» среди цифр сбивал шкалу — все пункты в месяцах (12), единицы названы в подписи главного числа и для читалки
  return seg(HORIZONS.map(([m]) => [String(m), String(m)] as const), String(k), (v) => void update((s) => ({ ...s, settings: { ...s.settings, forecastViewMonths: Number(v) } })), 'Срок прогноза, месяцев');
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
  // «на руках», как на «Обзоре» (D123): все счета, а не «капитал» (деньги минус долги); срок — «сегодня + N мес.» (D142), а не конец месяца
  const until = forecastDate(today(), k);
  const bal = (() => {
    const tr = forecastTraceNow().trace;
    return tr ? balanceOn(tr, until) : null;
  })();
  const onHand = bal ? bal.assets : null;
  const debtThen = bal ? bal.liabilities : (0 as Money);
  const stg = reserveCtx();
  const word = HORIZONS.find(([mm]) => mm === k)?.[2] ?? `${k} мес.`;
  root.append(
    horizonSeg(k),
    h(
      'section',
      { class: 'hero', 'aria-label': 'Прогноз' },
      h('div', { class: 'label' }, `На руках через ${word} будет`),
      h('div', { class: `value${(onHand ?? 0) < 0 ? ' neg' : ''}` }, onHand === null ? '—' : fmtShort(onHand)),
      h('div', { class: 'subline' }, `на ${formatDateRu(until)}, если всё пойдёт так же, как сейчас · сейчас ${fmtShort(ov().spend.onHand)}`),
      debtThen > 0 ? h('div', { class: 'subline' }, `Долги к тому времени: ещё ${fmtShort(debtThen)} — они не вычтены.`) : null,
      spendParts(),
    ),
  );
  if (sim.gaps.length) root.append(h('div', { class: 'badline' }, `Денег не хватит с ${fmtDay(sim.gaps[0]!.start)}: до ${fmt(sim.gaps[0]!.maxDeficit)}`));
  // ступень по запасу в будущем (аудит UX): вывод одной фразой, график с порогами, честно — что учтено и что нет
  {
    const ft = futureTrack(sim, k);
    if (ft && ft.months.length >= 2) {
      const sm = futureSummary(ft);
      const width = Math.min(720, document.documentElement.clientWidth - 56);
      root.append(
        h('section', { class: `card stack${sm.changed ? ' warn' : ''}`, 'aria-label': 'Запас в будущем' },
          h('strong', null, sm.headline),
          h('div', { class: 'muted' }, sm.detail),
          reserveChart(ft.months, ft.money, ft.need, `Деньги сразу и пороги запаса: ${sm.headline}`, width),
          h('p', { class: 'muted' }, unknownNote(plansCount())),
        ),
      );
    }
  }
  // проверка здравого смысла (D107): допущения, которые меняют вывод, — на виду, а не в «Как посчитано»
  // проверка здравого смысла (D107, D108): сначала вопросы, на которые человек может ответить, потом допущения
  const found = sanityCheck(st, today()).findings;
  const qs: HTMLElement[] = [];
  const drops = found.filter((f) => f.id === 'income_drop_flat_spend' && f.level === 'fail' && f.ref);
  for (const f of drops) qs.push(dropCard(f.text, f.months![0]!, f.ref!));
  const infl = found.find((f) => f.id === 'one_sided_inflation' && f.level === 'fail' && f.ref);
  if (infl) {
    const ids = new Set(infl.ref!.split(','));
    const setIdx = (id: string, v: boolean) => void act((s) => ({ ...s, settings: { ...s.settings, incomeSchedule: s.settings.incomeSchedule.map((x) => (x.id === id ? { ...x, indexed: v } : x)) } }), v ? 'Доход будет расти вместе с ценами' : 'Доход не растёт');
    const inflText = `${(st.settings.inflationBp / 100).toString().replace('.', ',')} %`;
    for (const x of st.settings.incomeSchedule.filter((i) => ids.has(i.id))) {
      const pv = previewIndexed(st, today(), x.id, 36);
      qs.push(
        h('section', { class: 'warnline stack', 'aria-label': 'Рост дохода' },
          h('strong', null, `«${x.title}» · ${fmt(x.amount)}. Растёт каждый год вместе с ценами?`),
          pv.yes !== null && pv.no !== null ? h('div', { class: 'muted' }, `Через 3 года: если да — ${fmtShort(pv.yes)}, если нет — ${fmtShort(pv.no)}`) : null,
          h('div', { class: 'chips wrap' }, h('button', { class: 'chip', type: 'button', onclick: () => setIdx(x.id, true) }, 'Да, вместе с ценами'), h('button', { class: 'chip', type: 'button', onclick: () => setIdx(x.id, false) }, 'Нет')),
          h('details', { class: 'fold' }, h('summary', null, 'Зачем это'), h('p', { class: 'muted' }, `Траты в прогнозе дорожают на ${inflText} в год. Если доход не растёт, остаток каждый год тает.`)),
        ),
      );
    }
  }
  const short = found.find((f) => f.id === 'labels_exceed_money' && f.level === 'fail');
  if (short) {
    qs.push(h('section', { class: 'warnline stack', 'aria-label': 'Не хватит денег' }, h('strong', null, short.text), h('div', { class: 'chips wrap' }, h('a', { class: 'chip', href: sheetHref('fc-draw', '') }, 'Выбрать цели'))));
  }
  // траты взяты за месяцы с другим доходом (D113): предложить считать по месяцам без зарплаты
  const bPv = found.some((f) => f.id === 'baseline_other_income') ? previewBaselineMode(st, today(), 12) : null;
  {
    const pv = bPv;
    if (pv) {
      const set = (mode: 'last' | 'no_work') => void act((x) => ({ ...x, settings: { ...x.settings, baselineMode: mode } }), mode === 'no_work' ? 'Обычные траты — по месяцам без зарплаты' : 'Обычные траты — по последним месяцам');
      qs.push(
        h(
          'section',
          { class: 'warnline stack', 'aria-label': 'Траты и зарплата' },
          h('strong', null, 'Траты считаются и по месяцам с зарплатой, а её больше нет. Считать по месяцам без неё?'),
          h('div', { class: 'muted' }, `Обычно уходит: ${fmt(pv.usualNow)} → ${fmt(pv.usualNoWork)} в месяц`),
          pv.capitalNow !== null && pv.capitalNoWork !== null ? h('div', null, `Через год: ${fmtShort(pv.capitalNow)} → ${fmtShort(pv.capitalNoWork)}.`) : null,
          h('div', { class: 'chips wrap' }, h('button', { class: 'chip', type: 'button', onclick: () => set('no_work') }, 'Да, без зарплаты'), h('button', { class: 'chip', type: 'button', onclick: () => set('last') }, 'Нет, как сейчас')),
        ),
      );
    }
  }
  // редкие траты (1–2 за год), которые прогноз раскладывает на каждый месяц, — спросить, повторятся ли (D110)
  const sparse = sparseExpenses(st, today(), ov());
  if (sparse.length) {
    qs.push(
      h(
        'section',
        { class: 'warnline stack', 'aria-label': 'Редкие траты' },
        h('strong', null, 'Эти траты были 1–2 раза за год, а прогноз тратит их каждый месяц. Повторятся?'),
        rows(sparse.slice(0, 3).map((x) => row({ title: x.title, sub: `${nWord(x.count, 'трата', 'траты', 'трат')} за год на ${fmt(x.total)} · в прогнозе ≈ ${fmt(x.monthly)} в месяц`, href: sheetHref('oneoff-q', x.categoryId) }))),
        sparse.length > 3 ? h('p', { class: 'muted' }, `Ещё ${sparse.length - 3} — после этих.`) : null,
      ),
    );
  }
  const asked = hiddenQuestions(found);
  qs.push(...asked.nodes);
  // вопросы — по одному (D121): стена из восьми карточек пугает, один вопрос с «Потом» — нет
  if (qs.length) {
    const i = qSkip % qs.length;
    root.append(
      h('div', { class: 'stack tight' },
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' }, h('span', { class: 'muted' }, `Вопрос ${i + 1} из ${qs.length}`), qs.length > 1 ? h('button', { class: 'chip', type: 'button', onclick: () => { qSkip = i + 1; refresh(); } }, 'Потом') : null),
        qs[i]!,
      ),
    );
  }
  // порядок — по важности: что меняет вывод сильнее, то выше
  const ORDER = ['income_drop_flat_spend', 'negative_months', 'cushion_ignores_money', 'labels_exceed_money', 'one_sided_inflation', 'baseline_other_income', 'expense_mismatch'];
  const sane = found
    .filter((f) => !(f.id === 'negative_months' && (st.settings.sanityAnswered ?? []).includes(`negative_months:${f.months?.[0]}`)))
    .filter((f) => ORDER.includes(f.id) && !drops.includes(f) && f !== infl && f !== short && !(bPv && f.id === 'baseline_other_income') && !asked.shown.has(f))
    .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  if (sane.length) {
    // у каждой находки — действие, которое её действительно убирает; без действия это не плашка, а справка (D120: «висит и ничего не предлагает» — раздражает).
    // «Порядок целей» плашку про подушку не убирал: порядок метки денег не меняет — теперь перенос в подушку или «так задумано» (D122)
    type Act = { label: string; href?: string; run?: () => void };
    const action = (f: SanityFinding): Act[] => {
      if (f.id === 'negative_months' && f.months?.[0]) {
        const d = `${f.months[0]}-01`;
        // аудит UX: у плашки был один выход — «урезать траты»; человек, который знает про минус и так и задумал, не мог её убрать.
        // Ответ привязан к первому «минусовому» месяцу: сдвинулся месяц — плашка вернётся.
        const key = `negative_months:${f.months[0]}`;
        return [
          { label: 'Урежу траты', href: sheetHref('plan', `cut@${d > today() ? d : today()}`) },
          { label: 'Знаю, скрыть', run: () => void act((s) => ({ ...s, settings: { ...s.settings, sanityAnswered: [...new Set([...(s.settings.sanityAnswered ?? []), key])] } }), 'Скрыто. Вернётся, если минус сдвинется на другой месяц') },
        ];
      }
      if (f.id === 'cushion_ignores_money') {
        return [
          ...(cushionFill(st, today(), 'preview') ? [{ label: 'В подушку', href: sheetHref('cushion-fill') }] : []),
          { label: 'Так задумано', run: () => void act((s) => ({ ...s, settings: { ...s.settings, sanityAnswered: [...new Set([...(s.settings.sanityAnswered ?? []), f.id])] } }), 'Записано: так задумано') },
        ];
      }
      if (f.id === 'goal_drawn') return [{ label: 'Выбрать, из чего брать', href: sheetHref('fc-draw', '') }];
      return [];
    };
    const acts = sane.map((f) => [f, action(f)] as const);
    const todo = acts.filter(([, a]) => a.length);
    const info = acts.filter(([, a]) => !a.length);
    if (todo.length) {
      root.append(
        h(
          'section',
          { class: 'warnline stack', 'aria-label': 'Проверь допущения' },
          h('strong', null, 'Прогноз точнее, если уточнить'),
          ...todo.map(([f, a]) => h('div', { class: 'stack tight' }, h('div', null, f.text), h('div', { class: 'chips wrap' }, a.map((x) => (x.href ? h('a', { class: 'chip', href: x.href }, x.label) : h('button', { class: 'chip', type: 'button', onclick: x.run }, x.label)))))),
        ),
      );
    }
    if (info.length) root.append(h('details', { class: 'fold' }, h('summary', null, `Что ещё стоит знать (${info.length})`), h('div', { class: 'stack' }, ...info.map(([f]) => h('p', { class: 'muted' }, f.text)))));
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
    // одна группа строк вместо четырёх отдельных карточек (D121)
    root.append(
      rows(
        row({ title: 'Из А в Б', sub: stg ? `сейчас запас на ${stg.coverMonths.toString().replace('.', ',')} мес. · выбери, куда выйти` : 'выбери нужный запас и путь к нему', href: sheetHref('a-to-b') }),
        row({ title: 'Где можно сэкономить', sub: 'на чём уходит больше всего и что это даст', href: sheetHref('save-where') }),
        row({ title: 'Если денег не хватит', sub: order.length ? `брать из: ${order.map((t) => `«${t}»`).join(', ')}` : 'сначала свободные деньги, потом — не выбрано', href: sheetHref('fc-draw', '') }),
        row({ title: 'Если станет хуже или лучше', sub: 'сценарии', href: '#/forecast-more' }),
      ),
      sub('Планирую…'),
      h('div', { class: 'chips wrap' }, [...PLAN_CHIPS.map((k) => h('a', { class: 'chip', href: sheetHref('plan', k) }, KINDS[k].label)), h('a', { class: 'chip', href: sheetHref('plan', 'own') }, 'Другое…')]),
    );
  }
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
  root.append(explainLink('forecast', 'Из чего прогноз'));
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
      amount > 0 ? (() => { const l = levelShiftLine(pv.base, pv.with); return l ? h('div', null, l) : null; })() : null,
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
      h('a', { class: 'chip', href: sheetHref('plan', `move@${from}`) }, 'Переезд, новые расходы'),
      h('button', { class: 'chip', type: 'button', onclick: () => void act((s) => ({ ...s, settings: { ...s.settings, incomeEndsAnswered: [...new Set([...(s.settings.incomeEndsAnswered ?? []), incomeId])] } }), 'Записано: ничего не изменится') }, 'Ничего не изменится'),
    ),
    // остальные доходы прогноз продолжает как есть — сказать прямо (D119)
    (() => {
      const others = st.settings.incomeSchedule.filter((x) => x.id !== incomeId && (!x.end || x.end > from));
      return others.length ? h('details', { class: 'fold' }, h('summary', null, 'Что с остальными доходами'), h('p', { class: 'muted' }, `Остальные доходы после этого прогноз продолжает как есть: ${others.map((x) => `«${x.title}» ${fmt(x.amount)}`).join(', ')}. Если какой-то тоже закончится — `, h('a', { href: '#/settings' }, 'укажи дату'), '.')) : '';
    })(),
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
      ...((l) => (l ? [h('div', null, l)] : []))(levelShiftLine(pv.base, pv.with)),
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


// ───────────────────────── «Из А в Б» (D123) ─────────────────────────

/** Куда человек хочет выйти (месяцев запаса) и за сколько месяцев — пока открыт экран. */
let routeTarget: ReserveTarget | null = null;
let routeDeadline = 6;
/** «Путь к ступени» на «Профиле» открывает «Из А в Б» сразу с нужной целью запаса. */
export function setRouteTarget(m: ReserveTarget): void {
  routeTarget = m;
}

defineSheet('a-to-b', () => {
  const st = getState();
  const t = today();
  const stg = reserveCtx();
  if (!stg) return { title: 'Из А в Б', body: h('p', { class: 'muted' }, 'Чтобы построить путь, нужны загруженные данные и размеченные траты.') };
  const ups = higherTargets(stg.coverMonths);
  const here = h(
    'section',
    { class: 'card stack tight', 'aria-label': 'Где ты сейчас' },
    h('div', { class: 'muted' }, 'А — сейчас'),
    h('strong', null, `Запас на ${stg.coverMonths.toString().replace('.', ',')} мес.`),
    h('p', null, `Денег хватит без дохода на ${stg.coverMonths.toString().replace('.', ',')} мес.: ${fmt(stg.liquid)} ÷ ${fmt(stg.needMonthly)} в месяц.`),
    h('a', { class: 'link', href: sheetHref('reserve-info'), style: 'display:flex;align-items:center;min-height:44px' }, 'Как посчитан запас ›'),
  );
  if (!ups.length) {
    return { title: 'Из А в Б', body: h('div', { class: 'stack' }, here, h('div', { class: 'okline' }, 'Запас на год и больше: дальше — не про запас, а про цели. Как делить остаток между ними, решаешь ты.'), h('a', { class: 'btn wide', href: '#/goals' }, 'К целям')) };
  }
  const to = (routeTarget !== null && ups.includes(routeTarget) ? routeTarget : stg.next!.months) as ReserveTarget;
  const r = routeTo(st, t, to)!;
  const pick = rows(ups.map((m) => row({ title: m === 12 ? 'Запас на год' : `Запас на ${m} ${m === 1 ? 'месяц' : m < 5 ? 'месяца' : 'месяцев'}`, sub: RESERVE_NOTES[m], value: m === to ? h('strong', null, '✓') : undefined, onClick: () => ((routeTarget = m), refresh()), chevron: false })));
  const toText = to === 12 ? 'запаса на год' : `запаса на ${to} ${to === 1 ? 'месяц' : to < 5 ? 'месяца' : 'месяцев'}`;

  const dl = r.deadlines.find((d) => d.months === routeDeadline) ?? r.deadlines[0];
  const dm = dl ? dl.month : null;
  const usual = ov().spend.usualMonthly;
  const fast = dl && dm
    ? dl.extraMonthly === 0
      ? h('div', { class: 'okline' }, `К ${monthTo(dm)} ты и так успеваешь — откладывать больше не нужно.`)
      : h(
          'div',
          { class: 'card stack tight' },
          h('strong', null, `Чтобы набрать ${toText} к ${monthTo(dm)}`),
          h('p', null, `Нужно откладывать сверху ≈ ${fmt(dl.extraMonthly)} в месяц${usual > 0 ? ` (${Math.round((dl.extraMonthly / usual) * 100)} % обычных трат)` : ''}.`),
          h('p', { class: 'muted' }, 'Меньше тратить или больше получать — для денег это одно и то же. Считается как (нужно − будет к сроку) ÷ месяцев до срока.'),
          h('button', { class: 'btn wide', type: 'button', onclick: () => void act((x) => ({ ...x, settings: { ...x.settings, plannedEvents: [...x.settings.plannedEvents, cutEvent(newId('ev'), `${monthKeyNext(t)}-01` as never, dl.extraMonthly, `Набрать ${toText} к ${monthTo(dm)}`)] } }), `В плане: на ${fmt(dl.extraMonthly)} в месяц больше, чтобы набрать ${toText} к ${monthTo(dm)}`) }, 'Добавить в план'),
        )
    : null;

  return {
    title: 'Из А в Б',
    body: h(
      'div',
      { class: 'stack' },
      here,
      sub('Б — какой запас нужен'),
      pick,
      sub('Что для этого нужно'),
      rows(
        row({ title: 'Уходит в обычный месяц', sub: 'траты и платежи по долгам', value: fmt(r.from.needMonthly), chevron: false }),
        row({ title: `Нужно денег: ${r.to} ${r.to === 1 ? 'месяц' : 'мес.'}`, sub: `${r.to} × ${fmt(r.from.needMonthly)}`, value: fmt(r.target), chevron: false }),
        row({ title: 'Есть сейчас', sub: 'можно снять сразу', value: fmt(r.from.liquid), chevron: false }),
        row({ title: h('strong', null, 'Не хватает'), value: h('strong', null, fmt(r.missing)), chevron: false }),
      ),
      r.deficitMonthly > 0 ? h('div', { class: 'badline' }, `Сейчас траты больше доходов на ≈ ${fmt(r.deficitMonthly)} в месяц — запас тает. Сначала нужно выйти в плюс: любая добавка ниже сначала закрывает эту дыру.`) : null,
      h('p', null, r.by ? h('strong', null, `Как сейчас — к ${monthTo(r.by)}.`) : 'Как сейчас — за пять лет прогноза не набирается: при нынешних доходах и тратах запас не вырастет до нужного.'),
      r.debtFree ? h('p', { class: 'muted' }, `Платежи по долгам кончатся к ${monthTo(r.debtFree.from)}: освободится ≈ ${fmt(r.debtFree.freed)} в месяц — это уже учтено.`) : null,
      r.steps.length > 1
        ? h('div', { class: 'stack tight' }, sub('По пути'), rows(r.steps.map((x) => row({ title: `Запас на ${x.months} ${x.months === 1 ? 'месяц' : x.months < 5 ? 'месяца' : 'месяцев'}`, sub: `нужно ${fmt(x.target)}`, value: x.by ? monthWord(x.by) : 'не набирается', chevron: false }))))
        : null,
      sub('Хочу быстрее'),
      seg(ROUTE_DEADLINES.map((n) => [String(n), n === 12 ? 'год' : n === 24 ? '2 года' : `${n} мес`] as const), String(dl?.months ?? routeDeadline), (v) => ((routeDeadline = Number(v)), refresh()), 'За сколько месяцев'),
      fast,
      h('div', { class: 'chips wrap' }, h('a', { class: 'chip', href: sheetHref('save-where') }, 'Где можно сэкономить'), h('a', { class: 'chip', href: sheetHref('plan', 'job') }, 'Добавить доход')),
      rows(row({ title: 'Нужно успеть цели к дате?', sub: 'выбери цель и месяц — посчитаю, что изменить', href: sheetHref('to-date') })),
      h('p', { class: 'muted' }, 'Это прикидка при нынешнем темпе, а не предсказание. Считается по тому, что есть в бэкапе: наличные и долги вне MoneyManager не видны.'),
    ),
  };
});

/** Запас в месяцах и «почему столько» — арифметика по шагам (D123, D143). */
defineSheet('reserve-info', () => {
  const s = reserveCtx();
  if (!s) return null;
  const cover = s.coverMonths.toString().replace('.', ',');
  return {
    title: 'Запас и почему столько',
    body: h(
      'div',
      { class: 'stack' },
      h('p', null, 'Запас — это на сколько месяцев хватит денег, если доход пропадёт. Больше ничего не учитывается: ни доходы, ни цели.'),
      sub('Как посчитано'),
      rows(
        row({ title: 'Необходимые траты в месяц', value: fmt(s.usualMonthly), chevron: false }),
        row({ title: '+ платежи по долгам и рассрочкам', value: fmt(s.obligationsMonthly), chevron: false }),
        row({ title: h('strong', null, '= уходит в месяц'), value: h('strong', null, fmt(s.needMonthly)), chevron: false }),
        row({ title: 'Деньги, которые можно снять сразу, за вычетом долгов людям', value: fmt(s.liquid), chevron: false }),
        row({ title: h('strong', null, `${fmt(s.liquid)} ÷ ${fmt(s.needMonthly)}`), value: h('strong', null, `${cover} мес.`), chevron: false }),
      ),
      s.next
        ? h('p', { class: 'muted' }, s.next.text)
        : h('p', { class: 'muted' }, 'Запас на год и больше — выше цели «Из А в Б» нет.'),
      h('p', { class: 'muted' }, `Отдельно от запаса: остаётся в месяц ${s.surplusMonthly >= 0 ? '+' : '−'}${fmt(Math.abs(s.surplusMonthly) as Money)} (в среднем за ближайшие полгода) — запас ${s.surplusMonthly >= 0 ? 'растёт' : 'тает'}.`),
      s.debtShare !== null && s.debtShare > 0 ? h('p', { class: 'muted' }, `На платежи по долгам и рассрочкам уходит ${Math.round(s.debtShare * 100)} % дохода.`) : null,
      h('a', { class: 'btn wide', href: sheetHref('a-to-b') }, 'Как набрать больше запаса ›'),
      h('p', { class: 'muted' }, 'Не видны наличные и долги вне MoneyManager — если они есть, запас может быть другим.'),
    ),
  };
});

// ───────────────────────── «Успеть к дате» (D117; до D122 называлось «Из А в Б») ─────────────────────────

let routeGoal: string | null = null;
let routeBy: string | null = null;

defineSheet('to-date', () => {
  const st = getState();
  const goals = listOrder(ov().goals).filter((g) => g.status === 'active' && !g.folder);
  if (!goals.length) return { title: 'Успеть к дате', body: h('p', { class: 'muted' }, 'Сначала заведи цель на «Целях» — например, подушку.') };
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
    title: 'Успеть к дате',
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
