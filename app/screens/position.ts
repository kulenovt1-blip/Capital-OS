/**
 * «Положение» (T11): уровень, три направления, слабое место, деньги, запас, независимость.
 * Экран ничего не считает: всё берётся из `positionViewOf` (engine/position/view.ts) и рисуется в порядке важности для телефона.
 * Слова без внутренних терминов; коды показателей (N1, V2…) на экране не показываются.
 */
import { DESIRED_LABEL, INDEPENDENCE_TEXTS, routeTo, type ReserveTarget, INDICATOR_LABELS, L5_NAME, LEVEL_NAMES, step, type Explanation, type PositionView } from '../../engine/index';
import { h } from '../dom';
import { explainLink, registerExplain } from '../explain';
import { getState, today } from '../store';
import { isSimpleMode } from '../../engine/index';
import { positionNow, reserveCtx, trust } from '../ctx';
import { fmt, fmtShort, info, monthTo, row, rows, sub } from '../ui';
import { setRouteTarget, ROUTE_PLAN_PREFIX } from './forecast-simple';
import { defineSheet, sheetHref } from '../main';
import { currencyRatesBlock } from './settings';
import { profileTour, tourSeen } from '../tours';
import { tourActive } from '../tour';

const nf = (x: number, d = 1): string => x.toFixed(d).replace('.', ',');
const money = (tenge: number) => fmt(Math.round(tenge * 100) as never);
const pct = (x: number): string => `${Math.round(x * 100)} %`;
/** Запас везде — округление вниз до десятых (К2 аудита UX): 6,45 → «6,4», как на «Обзоре». */
const nfDown = (x: number): string => (Math.floor(x * 10 + 1e-9) / 10).toFixed(1).replace('.', ',');
const mo = (x: number): string => (x >= 600 ? 'больше 50 лет' : `${nfDown(x)} мес.`);
/** Большие суммы — округлённо: «≈ 105 млн ₸», а не «около 105 410 163 ₸» (С4 аудита UX). */
const approx = (tenge: number): string => `≈ ${fmtShort(Math.round(tenge * 100) as never)}`;


function months(m: number | null): string {
  if (m === null) return 'не определить';
  return m >= 600 ? 'больше 50 лет' : `${Math.round(m)} мес.`;
}

// ───────────────────────── «Как посчитано» ─────────────────────────

function explanation(v: PositionView): Explanation {
  if (v.status === 'needs_rate') return [step('position.needs_rate', 'Есть счёт не в тенге без курса: уровень не оценивается', { level: 'warn' })];
  if (v.status === 'no_data') return [step('position.no_data', 'В бэкапе нет операций, профиль оценить нечем', { level: 'warn' })];
  const out: Explanation = [];
  out.push(step('position.rule', 'Как получается ступень: общая оценка из трёх направлений (слабое тянет вниз) плюс факты — запас от 3 месяцев для «Есть подушка», от 6 месяцев и все направления от 60 для «Защищён от ударов»', { detail: true }));
  out.push(step('position.level', `Ступень: ${v.level === null ? 'не определена' : `«${v.levelName}» (ступень ${v.level} из 5)`}${v.g !== null ? `, общая оценка ${nf(v.g)} из 100` : ''}`));
  for (const d of v.directions) {
    out.push(step(`position.dir.${d.id}`, `${d.name}: ${d.score === null ? 'оценить нечем' : `${nf(d.score)} из 100`}${d.reliable ? '' : ' (данных мало)'}`));
    for (const i of d.indicators) out.push(step(`position.ind.${i.id}`, `${i.label}: ${i.score === null ? 'пока неизвестно' : `${nf(i.score)} из 100`}`, { detail: true }));
  }
  for (const l of v.limitsFired) out.push(step(`position.limit.${l.id}`, `Оценка срезана, потому что ${l.text}`, { level: 'warn' }));
  if (v.held) out.push(step('position.held', `${v.held}`, { level: 'warn' }));
  if (v.next) out.push(step('position.next', `Чтобы подняться на «${v.next.name}»: ${v.next.needs.join('; ')}`));
  if (v.range) out.push(step('position.range', `Часть данных неизвестна, поэтому оценка — от ${nf(v.range.low)} до ${nf(v.range.high)}${v.range.showPoint ? `; ближе всего к ${nf(v.range.point)}` : ''}`));
  out.push(step('position.confidence', `Достоверность данных: ${pct(v.confidence)}${v.preliminary ? ' — ступень предварительная' : ''}`));
  return out;
}
registerExplain('position', 'Как посчитано: «Финансовый профиль»', () => explanation(positionNow()));

// ───────────────────────── блоки ─────────────────────────

/** Одна строка о надёжности — сразу под названием ступени (К3 аудита UX): причина словами и действие, без процентов. */
function trustLine(v: PositionView): HTMLElement | null {
  const f = v.directions.find((d) => d.id === 'F');
  if (!v.reconcileOk) return h('a', { class: 'pos-trust warn', href: '#/import' }, 'Уровень предварительный: баланс одного из счетов не совпал с MoneyManager · Посмотреть ›');
  if (f && f.score === null) return h('a', { class: 'pos-trust warn', href: '#/incomes' }, 'Уровень предварительный: нет расписания доходов · Указать ›');
  // про «мало данных» и «есть что проверить» говорит блок «Точность расчётов» — не дублируем
  return null;
}

/** Что ещё сказать про ступень — в отдельном листе, а не стеной текста под ней (D191). */
function levelMore(v: PositionView): HTMLElement[] {
  const isL5 = v.basis === 'independence';
  const out: HTMLElement[] = [];
  if (!isL5 && v.g !== null && (!v.range || v.range.showPoint)) out.push(h('p', null, `Общая оценка ${Math.round(v.g)} из 100. Чтобы быть на этой ступени, на каждом направлении нужно не меньше 60.`));
  if (v.level === 4) out.push(h('p', null, 'Это крепкая опора для большинства людей. Дальше — копить на свои цели; «Могу не работать» — далёкий горизонт, а не обязательный шаг.'));
  if (isL5) out.push(h('p', null, 'Капитал и независимый доход покрывают расходы и ещё четверть сверху на непредвиденное.'));
  if (v.range && v.rangeLevels) {
    out.push(
      h('p', { class: 'muted' },
        v.rangeLevels.low === v.rangeLevels.high
          ? `Часть данных неизвестна, но на ступень это не влияет: оценка от ${Math.round(v.range.low)} до ${Math.round(v.range.high)}.`
          : `Часть данных неизвестна: оценка от ${Math.round(v.range.low)} до ${Math.round(v.range.high)}, то есть от «${v.rangeLevels.low}» до «${v.rangeLevels.high}».${v.range.showPoint ? ` Ориентир — ${Math.round(v.range.point)}.` : ' Точнее сказать нельзя.'}`),
    );
  }
  return out;
}

defineSheet('level-more', () => {
  const v = positionNow();
  if (v.status !== 'ok') return null;
  return { title: `Ступень ${v.level ?? '—'} · ${v.levelName ?? ''}`, body: h('div', { class: 'stack' }, ...levelMore(v)) };
});

defineSheet('ladder', () => {
  const v = positionNow();
  if (v.status !== 'ok') return null;
  return {
    title: 'Все ступени',
    body: h('ol', { class: 'pos-ladder-list' },
      [...v.ladder].reverse().map((s) => h('li', { class: s.current ? 'is-current' : '' },
        h('div', { class: 'pos-ladder-name' }, `${s.level}. ${s.name}`, s.current ? h('span', { class: 'chip static' }, 'ты здесь') : null),
        h('div', { class: 'muted' }, s.meaning)))),
  };
});

/** Ступень: название, смысл одной строкой и три кнопки — без поясняющих абзацев (D191, замечание владельца: «много сплошного текста»). */
function levelCard(v: PositionView): HTMLElement {
  const key: HTMLElement[] = [];
  if (v.onBorder.length) key.push(h('p', { class: 'pos-note' }, 'Ты на границе ступеней: небольшое изменение сдвинет ступень.'));
  if (v.l4Unconfirmed) key.push(h('p', { class: 'pos-note' }, `По оценке это «${LEVEL_NAMES[4]}», но данных пока мало — показана ступень ниже.`));
  if (v.held) key.push(h('p', { class: 'pos-note' }, `${v.held}.`));
  return h(
    'div',
    { class: 'card stack pos-level-card', 'data-tour': 'level' },
    h('div', { class: 'pos-level-code' }, v.level === null ? '—' : `Ступень ${v.level} из 5`, v.preliminary ? h('span', { class: 'chip static' }, 'предварительно') : null),
    h('div', { class: 'pos-level-name' }, v.levelName ?? 'Оценить нечем'),
    v.levelMeaning ? h('p', { class: 'pos-meaning' }, `${meaningOf(v)}.`) : null,
    v.level !== null ? h('div', { class: 'pos-steps', 'aria-hidden': 'true' }, [1, 2, 3, 4, 5].map((n) => h('span', { class: n <= v.level! ? 'on' : '' }))) : null,
    ...key,
    trustLine(v),
    h(
      'div',
      { class: 'pos-actions' },
      h('a', { class: 'pos-act', href: sheetHref('ladder') }, 'Все ступени'),
      levelMore(v).length ? h('a', { class: 'pos-act', href: sheetHref('level-more') }, 'Подробнее') : null,
      h('button', { class: 'pos-act', type: 'button', onclick: () => void profileTour() }, 'Как читать'),
    ),
  );
}

/** При долговой спирали на ступени 2 фраза «денег хватает» стояла рядом с тревожными признаками — говорим одним тоном (К4 аудита UX). Если расходы больше доходов, это уже сказано в самой фразе (D173). */
function meaningOf(v: PositionView): string {
  if (v.level === 2 && v.spiral.spiral && !(v.levelMeaning ?? '').startsWith('Расходы больше доходов')) return 'Долги растут быстрее, чем гасятся. Начни с одного платежа';
  return v.levelMeaning ?? '';
}

/** Один маленький первый шаг, когда есть долговая спираль или просрочки (К4 аудита UX). */
function firstStepBlock(v: PositionView): HTMLElement | null {
  if (!v.spiral.spiral && v.overdue <= 0) return null;
  const title = v.overdue > 0 ? `Отметь, какие из ${v.overdue} ${v.overdue === 1 ? 'платежа' : 'платежей'} уже оплачены` : 'Посмотри платежи по долгам';
  const subText = v.overdue > 0 ? 'Возможно, часть из них просто не попала в операции, и просрочки на самом деле нет.' : 'Выбери один платёж, с которого начнёшь.';
  return h('div', { class: 'stack' }, sub('Сейчас важнее всего'), rows(row({ title, sub: subText, href: '#/debts', cls: 'warn' })));
}

/**
 * «Путь к ступени»: вместо «5 очков общей оценки» — сколько денег в запас, к какому сроку и что ускорит (аудит UX, этап 3).
 * Всё считает движок «Из А в Б» (`routeTo`); экран только показывает. null — если ступень не упирается в запас.
 */
function pathTarget(v: PositionView): ReserveTarget | null {
  if (v.level === null || v.level > 3 || !v.next) return null;
  return v.level <= 2 ? 3 : 6;
}
function pathBlock(v: PositionView): HTMLElement | null {
  const target = pathTarget(v);
  const rs = reserveCtx();
  if (target === null || !rs || rs.coverMonths >= target || !v.next) return null;
  const r = routeTo(getState(), today(), target);
  if (!r || r.missing <= 0) return null;
  const fast = r.deadlines.find((d) => d.months === 12 && d.extraMonthly > 0) ?? r.deadlines.find((d) => d.extraMonthly > 0);
  const pace = r.deficitMonthly > 0
    ? `Сейчас расходы больше доходов на ≈ ${fmtShort(r.deficitMonthly)} в месяц — сначала нужно выйти в плюс.`
    : r.by ? `Нынешним темпом — к ${monthTo(r.by)}.` : 'Нынешним темпом за пять лет не получается: расходы почти равны доходам.';
  const open = (): void => setRouteTarget(target);
  const planned = getState().settings.plannedEvents.find((e) => e.title.startsWith(ROUTE_PLAN_PREFIX));
  if (planned) {
    return h('section', { class: 'card stack tight pos-path', 'aria-label': 'Путь к следующей ступени', 'data-tour': 'path' },
      h('div', { class: 'muted' }, `Путь к ступени ${v.next.level} · «${v.next.name}»`),
      h('strong', null, 'План принят'),
      h('p', null, `В прогнозе: «${planned.title}». ${pace}`),
      h('a', { class: 'btn wide', href: sheetHref('a-to-b'), onclick: open }, 'Посмотреть или убрать'),
    );
  }
  return h('section', { class: 'card stack tight pos-path', 'aria-label': 'Путь к следующей ступени', 'data-tour': 'path' },
    h('div', { class: 'muted' }, `Путь к ступени ${v.next.level} · «${v.next.name}»`),
    h('strong', null, `Нужно отложить в запас ещё ${approx(r.missing / 100)}`),
    h('p', null, pace),
    fast && r.deficitMonthly <= 0 ? h('p', { class: 'muted' }, `Быстрее: откладывать сверху ≈ ${fmtShort(fast.extraMonthly)} в месяц — к ${monthTo(fast.month)}.`) : null,
    h('a', { class: 'btn wide', href: sheetHref('a-to-b'), onclick: open }, 'Посчитать путь'),
  );
}

function warningsBlock(v: PositionView): HTMLElement | null {
  if (!v.l4Warnings.length) return null;
  return h(
    'div',
    { class: 'warnline stack' },
    h('strong', null, `Это «${LEVEL_NAMES[4]}», но есть уязвимость`),
    v.l4Warnings.map((w) => h('div', null, w.text)),
    h('small', { class: 'hint' }, 'Ступень от этого не меняется: это объяснение, где профиль хрупкий.'),
  );
}

/** Слово рядом с очками (аудит 9, U4): «92» само по себе ничего не говорит. Черта 60 — порог уровня «Защищён от ударов». */
export function scoreWord(score: number): string {
  if (score >= 80) return 'сильно';
  if (score >= 60) return 'достаточно';
  if (score >= 40) return 'слабо';
  return 'мало';
}

/** Что измеряет каждый показатель и что значит 0 и 100 — простыми словами (аудит UX: «откуда у направления 100?»). */
const INDICATOR_HINTS: Readonly<Record<string, string>> = {
  N1: 'На сколько месяцев хватит денег без дохода. 100 — запас большой, 0 — почти нет.',
  N2: 'Какую часть дохода остаётся после трат (по последним 3 месяцам). 100 — откладываешь больше трети, 0 — всё уходит.',
  N3: 'Сколько дохода уходит на платежи по долгам и как велик сам долг. 100 — долгов нет, 0 — долги тяжёлые.',
  N4: 'Сколько месяцев жизни покрывает всё, что у тебя есть, минус долги. 100 — очень много, 0 — почти ничего.',
  V1: 'Как быстро выросли деньги за последние 6 месяцев по сравнению с твоей базой. 100 — быстрый рост, 35 — стоят на месте, 0 — заметно тают.',
  V2: 'Стало ли оставаться больше, чем раньше: свободный остаток последних 3 месяцев против предыдущих 3. 50 — без изменений.',
  V3: 'Платишь ли по долгам быстрее графика (больше 50) или отстаёшь (меньше 50).',
  V4: 'В скольких из последних 6 месяцев после трат осталось больше нуля. 100 — в каждом.',
  F1: 'Хватит ли денег в плохой период по прогнозу на год. 100 — с запасом, 0 — не хватит.',
  F2: 'Покрывают ли надёжные доходы за год необходимые расходы. 100 — с запасом, 0 — нет.',
  F3: 'Насколько всё держится на одном источнике дохода. 100 — потеря любого переживаешь, 10 — один источник и он шаткий.',
  F4: 'Сколько удастся откладывать в будущем по прогнозу.',
};

function directionsBlock(v: PositionView): HTMLElement {
  return h(
    'div',
    { class: 'stack', 'data-tour': 'dirs' },
    rows(
      ...v.directions.map((d) =>
        h('details', { class: 'fold row-fold', 'data-key': `position:${d.id}` },
          h('summary', null, h('span', { class: 'rf-title' }, d.name), h('span', { class: 'rf-val' }, d.score === null ? 'мало данных' : `${scoreWord(d.score)} · ${Math.round(d.score)}${d.reliable ? '' : ' · данных мало'}`),
            // полоска с чертой порога 60 (форма Г, D166)
            d.score === null ? null : h('span', { class: 'dbar', 'aria-hidden': 'true' }, h('span', { class: 'dfill', style: `width:${Math.max(0, Math.min(100, d.score))}%` }), h('span', { class: 'dtick' }))),
          h('p', { class: 'muted' }, d.question),
          rows(...d.indicators.map((i) => row({ title: i.label, sub: INDICATOR_HINTS[i.id], value: i.score === null ? 'пока неизвестно' : `${scoreWord(i.score)} · ${Math.round(i.score)}`, chevron: false })))),
      ),
    ),
  );
}

/** Слабое место и что нужно для следующей ступени — одной карточкой: заголовок крупно, показатель — плашкой (D191). */
function weakBlock(v: PositionView, hasPath = false): HTMLElement | null {
  const next = v.next && !hasPath ? v.next : null;
  if (!v.weak && !next && !v.limitsFired.length) return null;
  return h(
    'div',
    { class: 'pos-focus', 'data-tour': 'weak' },
    v.weak
      ? h('div', { class: 'pf-row' },
          h('div', null, h('div', { class: 'pf-k' }, 'Слабое место'), h('div', { class: 'pf-v' }, v.weak.directionName)),
          v.weak.indicator ? h('span', { class: 'pf-chip' }, `${v.weak.indicator.label} · ${Math.round(v.weak.indicator.score)}`) : null)
      : null,
    next ? h('div', { class: 'pf-next' }, h('div', { class: 'pf-k' }, `До «${next.name}»`), h('ul', null, next.needs.map((n) => h('li', null, n)))) : null,
    v.limitsFired.map((l) => h('div', { class: 'pf-limit' }, `Сдерживает: ${l.text}`)),
  );
}

/** Деньги — плитками: капитал крупно с арифметикой «есть − долги» мелко, запас и «можно снять» рядом. Пояснения — в ⓘ (D191). */
function moneyBlock(v: PositionView): HTMLElement {
  const m = v.money;
  const debts = m.gross - m.total;
  const short = (t: number) => fmtShort(Math.round(t * 100) as never);
  const spendable = Math.abs(m.total - m.spendable) > 0.05 * Math.max(Math.abs(m.total), 1);
  return h(
    'div',
    { class: 'stack', 'data-tour': 'money' },
    sub('Деньги', info('capitalTwo')),
    h(
      'div',
      { class: 'pos-tiles' },
      h('div', { class: 'cell wide' }, h('div', { class: 'k' }, 'Всего капитал'), h('div', { class: 'v' }, money(m.total)), h('div', { class: 'cs' }, debts > 0.5 ? `есть ${short(m.gross)} − долги ${short(debts)}` : 'долгов нет')),
      h('a', { class: 'cell', href: sheetHref('reserve-info') }, h('div', { class: 'k' }, 'Запас'), h('div', { class: 'v' }, mo(m.reserveEssentialMonths)), h('div', { class: 'cs' }, 'без дохода ›')),
      spendable ? h('div', { class: 'cell' }, h('div', { class: 'k' }, 'Снять за месяц'), h('div', { class: 'v' }, short(m.spendable)), h('div', { class: 'cs' }, 'после платежей и трат')) : null,
    ),
  );
}

/** Жильё и закрытые активы — отдельной строкой, на ступень не влияют: у владельца жилья нет аренды и есть актив, но денег на месяц он не даёт. */
function housingBlock(v: PositionView): HTMLElement | null {
  const hs = v.housing;
  if (!hs) return null;
  const hasLoan = hs.linked > 0;
  return h(
    'div',
    { class: 'stack' },
    sub('Жильё и закрытые активы'),
    rows(
      row({ title: hasLoan ? 'Твоя доля' : 'Стоимость', sub: hasLoan ? `${money(hs.assets)} за вычетом остатка кредита ${money(hs.debt)}` : 'жильё и деньги, которые нельзя снять за месяц; в запас не входят', value: money(hasLoan ? hs.equity : hs.assets), href: '#/accounts' }),
    ),
    h('p', { class: 'muted' }, 'Ступень считается по деньгам и доходу: этот актив на неё не влияет. В «Всего капитал» он учтён.'),
  );
}

function runwayBlock(v: PositionView): HTMLElement | null {
  const r = v.runway;
  if (r.status === 'no_data') return h('div', { class: 'stack' }, sub('Если доход пропадёт'), h('p', { class: 'muted' }, 'Нужно хотя бы три полных месяца истории, чтобы это посчитать.'));
  // С7 (D164): под этим заголовком — ответ на сам вопрос: на сколько месяцев хватит денег без дохода (запас из условий ступени)
  // то же самое уже сказано строкой «Запас» выше — второй раз не повторяем
  if (r.status === 'no_deficit') return null;
  return h(
    'div',
    { class: 'stack' },
    sub('Если ничего не менять', info('runway')),
    rows(row({ title: `Тратишь больше, чем получаешь: ${money(r.deficit)} в месяц`, sub: r.months === null ? 'на сколько хватит денег, определить нельзя' : r.months >= 600 ? 'при этом денег хватит более чем на 50 лет' : `при этом денег хватит на ${months(r.months)}`, chevron: false, cls: 'warn' })),
    r.scenarios.length
      ? h('details', { class: 'fold', 'data-key': 'position:runway' }, h('summary', null, 'А если…'), rows(...r.scenarios.map((s) => row({ title: s.name, value: months(s.months), chevron: false }))))
      : null,
  );
}

function spiralBlock(v: PositionView): HTMLElement | null {
  const items: HTMLElement[] = [];
  if (v.spiral.spiral) items.push(row({ title: 'Признаки долговой спирали', sub: 'похоже, ты берёшь в долг, чтобы платить по долгам или жить; такие признаки найдены в двух из трёх проверок', chevron: false, cls: 'warn' }));
  if (v.overdue > 0) items.push(row({ title: `Есть просроченные платежи: ${v.overdue}`, sub: 'платёж по графику есть, а в операциях его нет', href: '#/debts', cls: 'warn' }));
  return items.length ? rows(...items) : null;
}

function independenceBlock(v: PositionView): HTMLElement | null {
  const i = v.independence;
  if (i.status === 'not_assessed') return v.independenceLine ? h('div', { class: 'stack' }, sub('Независимость', info('independence')), h('p', { class: 'muted' }, v.independenceLine)) : null;
  const col = (title: string, c: number, total: number) => h('div', { class: 'pos-col' }, h('div', { class: 'k' }, title), h('div', { class: 'v' }, pct(total)), h('div', { class: 'muted' }, `капитал: ${pct(c)}`));
  return h(
    'div',
    { class: 'stack' },
    sub('Независимость', info('independence')),
    h('div', { class: 'card stack' },
      h('p', { class: 'muted' }, 'Какую часть расходов покрывает капитал и независимый доход. Чтобы можно было не работать, нужно 125 %: расходы и ещё четверть на непредвиденное.'),
      h('div', { class: 'pos-cols' }, col(INDEPENDENCE_TEXTS.centralLabel, i.c.central, i.total.central), col(INDEPENDENCE_TEXTS.conservativeLabel, i.c.conservative, i.total.conservative)),
      i.p > 0 ? h('p', { class: 'muted' }, `Независимые поступления (пенсия, аренда и т. п.) покрывают ${pct(i.p)} расходов`) : null,
      i.status === 'not_confirmed' && i.requiredCapital > 0 ? h('p', { class: 'muted' }, `Чтобы можно было не работать, нужно ${approx(i.requiredCapital)} (обычный прогноз)`) : null,
      v.independenceNote ? h('p', { class: 'muted' }, v.independenceNote.replace(/\b([NVF][1-4])\b/g, (c) => INDICATOR_LABELS[c as keyof typeof INDICATOR_LABELS]?.toLowerCase() ?? c)) : null,
      h('small', { class: 'hint' }, `${INDEPENDENCE_TEXTS.scenarioNote}. ${INDEPENDENCE_TEXTS.assumptions.replace(/^./, (c) => c.toUpperCase())}`)),
  );
}

function desiredBlock(v: PositionView): HTMLElement | null {
  const d = v.desired;
  if (!d) return null;
  const i = d.independence;
  const col = (title: string, tot: number, sub2: string) => h('div', { class: 'pos-col' }, h('div', { class: 'k' }, title), h('div', { class: 'v' }, pct(tot)), h('div', { class: 'muted' }, sub2));
  const level = i.status === 'not_assessed'
    ? 'при таких расходах независимость оценить нечем: данных не хватает'
    : d.hypotheticalLevel === 5 ? `при таких расходах получилось бы «${L5_NAME}»` : `при таких расходах «${L5_NAME}» не получилось бы`;
  return h(
    'div',
    { class: 'stack' },
    sub(`При желаемых расходах (${DESIRED_LABEL})`, info('desiredScenario')),
    h('div', { class: 'card stack' },
      h('p', { class: 'muted' }, `А если бы ты тратил ${money(d.desired)} в месяц, а не ${money(d.current)}. Капитал и доходы те же. Это гипотеза: основная ступень от неё не меняется.`),
      h('div', { class: 'pos-cols' },
        col('Сейчас', v.independence.total.central, `при ${money(d.current)} в месяц`),
        col(`Гипотеза`, i.total.central, `при ${money(d.desired)} в месяц`)),
      h('p', { class: 'muted' }, `Цифры — по обычному прогнозу; по осторожному — ${pct(i.total.conservative)}. Нужно 125 %.`),
      i.requiredCapital > 0 ? h('p', { class: 'muted' }, `Нужно ${approx(d.requiredCapital.desired)} (сейчас для ${money(d.current)} в месяц — ${approx(d.requiredCapital.current)}).`) : h('p', { class: 'muted' }, 'Порог достигается уже за счёт независимых поступлений.'),
      h('p', { class: 'muted' }, `Запас денег при таких тратах — ${mo(d.reserveMonths)}`),
      h('p', null, level.replace(/^./, (c) => c.toUpperCase()) + '.'),
      h('small', { class: 'hint' }, INDEPENDENCE_TEXTS.scenarioNote)),
  );
}

defineSheet('profile-more', () => {
  const v = positionNow();
  if (v.status !== 'ok') return null;
  const parts = [housingBlock(v), runwayBlock(v), ...(v.money.total < 0 && v.independence.status !== 'not_assessed' ? [h('p', { class: 'muted' }, 'Независимость сейчас не считается: сначала долги.')] : [independenceBlock(v), desiredBlock(v)])].filter((x): x is HTMLElement => x !== null);
  return { title: 'Подробнее о профиле', body: h('div', { class: 'stack' }, ...parts) };
});

/** Независимость нужна единицам: на экране — одна строка, подробности — по нажатию; целиком только когда она рядом (≥ 20 %) или достигнута. */
const INDEPENDENCE_INLINE_FROM = 0.2;
defineSheet('independence', () => {
  const v = positionNow();
  if (v.status !== 'ok') return null;
  const ind = independenceBlock(v);
  const ds = desiredBlock(v);
  return { title: 'Могу не работать', body: h('div', { class: 'stack' }, ind, ds) };
});
function independenceSection(v: PositionView): HTMLElement[] {
  const i = v.independence;
  // человек сам задал «желаемые траты» — сценарий показываем сразу, он за ним и пришёл
  const near = v.level === 5 || v.desired !== null || (i.status !== 'not_assessed' && i.total.central >= INDEPENDENCE_INLINE_FROM);
  if (i.status === 'not_assessed' || near) return [independenceBlock(v), desiredBlock(v)].filter((x): x is HTMLElement => x !== null);
  return [rows(row({ title: 'Независимость', sub: 'когда можно не работать', value: `${pct(i.total.central)} пути`, href: sheetHref('independence') }))];
}

export function renderPosition(): HTMLElement {
  const v = positionNow();
  const root = h('div', { class: 'screen' });
  if (v.status === 'no_data') {
    root.append(h('div', { class: 'card stack' }, h('strong', null, 'Профиль пока не оценить'), h('p', { class: 'muted' }, 'Для оценки нужны операции из MoneyManager.'), h('a', { class: 'btn primary wide', href: '#/import' }, 'Загрузить бэкап')));
    return root;
  }
  if (v.status === 'needs_rate') {
    root.append(
      h('div', { class: 'card stack' }, h('strong', null, 'Профиль пока не оценить'), h('p', { class: 'muted' }, `Счёт ${v.unrated.map((a) => `«${a.title}» (${a.currency})`).join(', ')} не в тенге. Без курса ступень, запас и прогноз были бы неверными — укажи курс ниже.`)),
      currencyRatesBlock([...new Set(v.unrated.map((a) => a.currency))]),
    );
    return root;
  }
  root.append(levelCard(v));
  // первый заход на «Профиль» — подсказка по блокам сама, один раз (не поверх окна «Что нового»)
  if (!tourSeen('profile') && !tourActive()) setTimeout(() => !tourActive() && !document.querySelector('.modal-back') && location.hash.startsWith('#/position') && !tourSeen('profile') && void profileTour(), 700);
  const fs = firstStepBlock(v);
  if (fs) root.append(fs);
  const path = pathBlock(v);
  if (path) root.append(path);
  const w = warningsBlock(v);
  if (w) root.append(w);
  if (v.essentialMissing) root.append(rows(row({ title: 'Отметь, что обязательно', sub: 'ни одна трата не отмечена как «без этого не прожить» — запас считается неточно', href: '#/markup', cls: 'warn' })));
  root.append(directionsBlock(v));
  const wk = weakBlock(v, path !== null);
  if (wk) root.append(wk);
  root.append(moneyBlock(v));
  const sp = spiralBlock(v);
  // простой режим (D185): жильё, «если доход пропадёт» и независимость — за одной строкой «Подробнее»; тревожные признаки (спираль, просрочки) остаются на виду
  if (isSimpleMode(getState().settings)) {
    if (sp) root.append(sp);
    root.append(rows(row({ title: 'Подробнее', sub: 'без дохода, жильё, независимость', href: sheetHref('profile-more') })));
    root.append(h('div', { class: 'foot-note' }, explainLink('position')));
    return root;
  }
  const hb = housingBlock(v);
  if (hb) root.append(hb);
  const rw = runwayBlock(v);
  if (rw) root.append(rw);
  if (sp) root.append(sp);
  // при отрицательном капитале «нужен капитал на миллиарды» только стыдит — сначала долги
  if (v.money.total < 0 && v.independence.status !== 'not_assessed') {
    root.append(h('p', { class: 'muted' }, 'Независимость сейчас не считается: сначала долги. Когда капитал станет положительным, здесь появится путь.'));
  } else {
    root.append(...independenceSection(v));
  }
  root.append(h('div', { class: 'foot-note' }, explainLink('position')));
  return root;
}

/** Строка-карточка для «Обзора»: уровень и ссылка на полный экран. null — показывать нечего. */
export function positionRow(): HTMLElement | null {
  const v = positionNow();
  if (v.status === 'no_data' || v.level === null) return null;
  // один запас на «Обзоре» (К4, этап 2): та же цифра, что в условиях ступени
  const reserve = v.money.reserveEssentialMonths > 0 ? `запас ${mo(v.money.reserveEssentialMonths)}` : '';
  const note = !v.reconcileOk ? 'предварительно — сверка не сошлась' : v.preliminary ? 'предварительно — данных пока мало' : '';
  return rows(row({ title: `Ступень ${v.level} · ${v.levelName}`, sub: [reserve, note].filter(Boolean).join(' · ') || undefined, href: '#/position' }));
}

export { sheetHref };
