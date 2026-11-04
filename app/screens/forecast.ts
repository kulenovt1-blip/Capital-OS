/**
 * «График и сценарии» (D87, второй слой после D96): срок, капитал по сценариям «хуже — как сейчас — лучше», таблица,
 * кассовые разрывы, когда достигнешь целей. События «что если» — на главном «Прогнозе» («Планирую…», D101).
 */
import {
  buildSimInput, kindBehavior, runForecast, formatMonthRu, formatDateRu,
  type Money, type MonthKey, type Scenario, type SimInput, type SimResult,
} from '../../engine/index';
import { bandChart } from '../chart';
import { h } from '../dom';
import { getState, today, update } from '../store';
import { ov } from '../ctx';
import { attention, fmt, fmtShort, info, row, rows, seg, sub, type AttentionItem } from '../ui';
import { defineSheet, sheetHref } from '../main';
import { explainLink, registerExplain } from '../explain';

/**
 * Сроки прогноза (D120, D122): 1–5 мес. проверяются жизнью («через 3 месяца» можно сверить, «через год» нет), полгода и год — как было.
 * Дальше года главное число не показывается (D100): через 2–5 лет жизнь почти наверняка другая — для этого «Планирую…».
 * Один набор и один выбор срока (`settings.forecastViewMonths`) на «Прогнозе» и на «Хуже или лучше».
 */
export const HORIZONS: [number, string, string][] = [
  [1, '1', 'месяц'],
  [2, '2', '2 месяца'],
  [3, '3', '3 месяца'],
  [4, '4', '4 месяца'],
  [5, '5', '5 месяцев'],
  [6, '6', 'полгода'],
  [12, 'год', 'год'],
];

/** Названия сценариев одинаково везде (D102): «Хуже / Так же / Лучше» — три сравнения с тем, что сейчас. */
export function scenarioWord(sc: Pick<Scenario, 'id' | 'name'>): string {
  return ({ base: 'Так же', adverse: 'Хуже', favorable: 'Лучше' } as Record<string, string>)[sc.id] ?? sc.name;
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

/**
 * Что меняет сценарий — на твоих цифрах (D101): «Зарплата 180 000 → 144 000 ₸ в месяц», а не «доход от работы −20 %».
 * То, чего в твоих данных нет (например, дохода от работы), так и называется — «не меняется, у тебя его нет».
 */
function describeScenario(sc: Scenario, input: SimInput): string[] {
  const p = sc.patch;
  const out: string[] = [];
  const factor = (bp: number) => (bp === 10000 ? null : bp > 10000 ? `на ${(bp - 10000) / 100}% больше` : `на ${(10000 - bp) / 100}% меньше`);
  for (const x of input.incomes) {
    const k = kindBehavior(p, x.kind);
    const f = k.factorBp;
    if (f !== undefined && f !== 10000) out.push(f === 0 ? `«${x.title}» — дохода не будет (сейчас ${fmt(x.amount)} в месяц)` : `«${x.title}»: ${fmt(x.amount)} → ${fmt(Math.round((x.amount * f) / 10000) as Money)} в месяц (${factor(f)})`);
  }
  if (!input.incomes.some((x) => x.kind === 'work') && (p.workIncomeFactorBp ?? 10000) !== 10000) out.push('доход от работы: у тебя его сейчас нет — поэтому тут ничего не меняется');
  if (p.workDelayMonths) out.push(`если в плане есть новая работа — она начнётся на ${p.workDelayMonths} мес. позже`);
  const spend = input.expenses.reduce((a, x) => a + x.monthly, 0);
  if (p.expenseFactorBp !== undefined && p.expenseFactorBp !== 10000 && spend > 0) out.push(`траты: ${fmt(spend as Money)} → ${fmt(Math.round((spend * p.expenseFactorBp) / 10000) as Money)} в месяц (${factor(p.expenseFactorBp)})`);
  if (p.oneOffMonthsOfBaseBp && input.baseMedian > 0) out.push(`через ${p.oneOffMonthOffset ?? 0} мес. — непредвиденная трата ${fmt(Math.round((input.baseMedian * p.oneOffMonthsOfBaseBp) / 10000) as Money)} (поломка, лечение — как месяц обычных трат)`);
  return out;
}

defineSheet('fc-scenarios', () => {
  const st = getState();
  const rs = runForecast(st, today());
  const { input } = buildSimInput(st, today());
  const base = rs.find((r) => r.scenarioId === 'base') ?? rs[0];
  return {
    title: 'Что значит «хуже» и «лучше»',
    body: h(
      'div',
      { class: 'stack' },
      h('p', null, 'Это не предсказание, а проверка на прочность: что будет с деньгами, если часть дел пойдёт хуже или лучше, чем сейчас. Главное число — если всё пойдёт так же.'),
      ...st.settings.scenarios
        .filter((sc) => sc.id !== 'base')
        .map((sc) => {
          const r = rs.find((x) => x.scenarioId === sc.id);
          const d = describeScenario(sc, input);
          const same = !!(r && base && sameAs(r, base));
          return h(
            'div',
            { class: 'card stack tight' },
            h('strong', null, sc.id === 'adverse' ? 'Если будет хуже' : sc.id === 'favorable' ? 'Если будет лучше' : scenarioWord(sc)),
            d.length ? h('ul', { class: 'help-list' }, d.map((x) => h('li', null, x))) : h('div', { class: 'muted' }, 'Ничего не меняет.'),
            same ? h('div', { class: 'muted' }, 'У тебя этот вариант совпадает с «Так же»: то, что он меняет, в твоих данных не встречается.') : null,
          );
        }),
      h('a', { class: 'btn', href: '#/advanced/scenarios' }, 'Изменить эти допущения'),
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
          `Это папка: ${kids.map((k) => `«${k.title}»`).join(', ')}. Деньги получают цели внутри, баланс папки — их сумма.`,
        )
      : null,
    h('p', null, `Сейчас на ней ${fmt(start as Money)}. ${avg > 0 ? `В среднем ей достаётся ${fmt(avg as Money)} в месяц.` : 'Из прироста ей пока ничего не достаётся.'}`),
    !kids.length && avg === 0 && !reached ? h('p', { class: 'muted' }, 'Свободные деньги каждого месяца сначала идут на подушку и на цели со сроком, потом — целям без срока по порядку списка; этой цели не остаётся. Подними её выше в списке «Целей» или поставь срок.') : null,
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

export function warningItems(): { items: AttentionItem[]; missing: { title: string; href: string; label: string }[] } {
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
  const avail = HORIZONS.filter(([m]) => m <= maxM);
  const k = avail.some(([m]) => m === (st.settings.forecastViewMonths ?? 12)) ? (st.settings.forecastViewMonths ?? 12) : (avail[avail.length - 1]?.[0] ?? 12);
  const word = HORIZONS.find(([m]) => m === k)?.[2] ?? `${k} мес.`;

  root.append(seg(avail.map(([m, l]) => [String(m), l] as const), String(k), (v) => void update((s) => ({ ...s, settings: { ...s.settings, forecastViewMonths: Number(v) } })), 'Срок прогноза'));
  // `capitalAfter` есть только для 6/12/24/36 мес.; короткие сроки берём из помесячного ряда
  const capAt = (r: SimResult, m: number): Money | null => r.months[Math.min(m, r.months.length - 1)]?.capital ?? null;
  const cap = (r: SimResult) => capAt(r, k);
  const lo = cap(tr.worse);
  const hi = cap(tr.better);
  const betterSame = sameAs(tr.better, tr.base);
  const worseSame = sameAs(tr.worse, tr.base);
  // одно главное число — база; остальные сценарии словами, с объяснением, что они меняют (D93)
  const alt = [worseSame || lo === null ? null : `если будет хуже — ${fmtShort(lo)}`, betterSame || hi === null ? null : `если лучше — ${fmtShort(hi)}`].filter(Boolean).join(' · ');
  root.append(
    h(
      'section',
      { class: 'hero', 'aria-label': `Капитал через ${word}` },
      h('div', { class: 'label' }, h('span', null, `Всего у тебя будет через ${word}`, info('net'))),
      h('div', { class: `value${(cap(tr.base) ?? 0) < 0 ? ' neg' : ''}` }, cap(tr.base) === null ? '—' : fmtShort(cap(tr.base)!)),
      h('div', { class: 'subline' }, 'если всё пойдёт так же, как сейчас', alt ? ` · ${alt}` : ''),
      h('a', { class: 'link', href: sheetHref('fc-scenarios') }, 'Что значит «хуже» и «лучше» ›'),
    ),
  );

  const n = Math.min(k + 1, tr.base.months.length);
  const months = tr.base.months.slice(0, n).map((m) => m.month);
  const vals = (r: SimResult) => r.months.slice(0, n).map((m) => m.capital);
  const width = Math.min(720, Math.min(960, document.documentElement.clientWidth) - 40);
  root.append(h('div', { class: 'card' }, bandChart(months, vals(tr.base), vals(tr.worse), vals(tr.better), `Капитал на конец месяца, ${k < 12 ? `${k} мес.` : '1 год'}`, width)));

  // таблица: 4 колонки и на телефоне
  const horizons = avail.map(([m]) => m);
  root.append(
    h(
      'table',
      { class: 'tbl four' },
      h('caption', { class: 'visually-hidden' }, 'Капитал по сценариям'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Срок'), worseSame ? null : h('th', { scope: 'col' }, 'Хуже'), h('th', { scope: 'col' }, 'Так же'), betterSame ? null : h('th', { scope: 'col' }, 'Лучше'))),
      h(
        'tbody',
        null,
        horizons.map((m) =>
          h(
            'tr',
            { class: m === k ? 'on' : '' },
            h('th', { scope: 'row' }, m < 12 ? `${m} мес` : m === 12 ? '1 год' : `${m / 12} года`),
            worseSame ? null : h('td', null, short(capAt(tr.worse, m))),
            h('td', null, h('strong', null, short(capAt(tr.base, m)))),
            betterSame ? null : h('td', null, short(capAt(tr.better, m))),
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

  root.append(explainLink('forecast'));
  return root;
}

