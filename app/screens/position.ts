/**
 * «Положение» (T11): уровень, три направления, план к следующей ступени, деньги, запас.
 * Экран ничего не считает: всё берётся из `positionViewOf` (engine/position/view.ts) и рисуется в порядке важности для телефона.
 * Слова без внутренних терминов; коды показателей (N1, V2…) на экране не показываются.
 */
import { leftText, roadOf, roadHowOf, type RoadCond } from '../road';
import { SAVING_CUT_PCT, savingOptions, routeTo, type ReserveTarget, LEVEL_NAMES, step, type Explanation, type PositionView } from '../../engine/index';
import { h } from '../dom';
import { explainLink, registerExplain } from '../explain';
import { act, getDemo, getState, today } from '../store';
import { isSimpleMode } from '../../engine/index';
import { WEAK_NONE_FROM, shownScore } from '../../engine/position/view';
import { positionNow, reserveCtx, trust } from '../ctx';
import { fmt, fmtShort, info, monthTo, row, rows, sub } from '../ui';
import { reserveRouteParts, setRouteTarget, ROUTE_PLAN_PREFIX } from './plan-how';
import { defineSheet, sheetHref } from '../main';
import { currencyRatesBlock } from './settings';
import { autoTour, personaTour, profileTour } from '../tours';

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
  out.push(step('position.rule', 'Как получается ступень: общая оценка из трёх направлений (слабое тянет вниз) плюс факты — запас от 3 месяцев для «Есть подушка», от 6 месяцев и все направления от 60 для «Защищён от ударов»; для «Могу не смотреть на цены» — деньги на год обычной жизни, на обязательное до половины дохода и откладывать от 10 % дохода в 5 из 6 месяцев', { detail: true }));
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
  if (v.essentialUnknown) return h('a', { class: 'pos-trust warn', href: '#/markup' }, 'Уровень предварительный: не отмечено, что обязательно — запас по необходимому не определён · Отметить ›');
  // про «мало данных» и «есть что проверить» говорит блок «Точность расчётов» — не дублируем
  return null;
}

/** «Почему ты здесь» — в листе «Ступени», фактами, а не правилом чужой ступени (D217: «на каждом направлении от 60» раньше показывалось на всех ступенях). */
function levelMore(v: PositionView): HTMLElement[] {
  const out: HTMLElement[] = [];
  const why = whyHere(v);
  if (why) out.push(h('p', null, h('strong', null, 'Почему ты здесь. '), why));
  if (v.g !== null && (!v.range || v.range.showPoint) && v.level !== null && v.level < 5) out.push(h('p', { class: 'muted' }, `Общая оценка — ${shownScore(v.g)} из 100. Она собирается из трёх направлений и растёт сама, когда меняются деньги; что нужно для следующей ступени — в «Плане».`));
  if (v.level === 4) out.push(h('p', null, `Это крепкая опора. Следующая ступень — «${LEVEL_NAMES[5]}»: деньги на год обычной жизни и свобода в каждой зарплате.`));
  if (v.level === 5) out.push(h('p', null, 'Это верхняя ступень. Главное теперь — не растерять: чтобы обязательное не росло быстрее дохода и запас не таял.'));
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

/** «Почему ты здесь» — факты, на которых стоит ступень (D217), а не повтор её смысла. */
function whyHere(v: PositionView): string | null {
  if (v.level === null) return null;
  if (v.held) return `${v.held}.`;
  const r = v.essentialUnknown ? null : nfDown(v.money.reserveEssentialMonths);
  const g = v.g !== null ? shownScore(v.g) : null;
  const res = r === null ? '' : `запас на ${r} мес. необходимых расходов`;
  switch (v.level) {
    case 1: return `${meaningOf(v)}.`;
    case 2: return [v.runway.status === 'deficit' ? 'расходы больше доходов, но запас от 3 месяцев' : 'доходы покрывают расходы', res && `${res} (для ступени 3 нужно от 3)`, g !== null && g < 40 ? `общая оценка ${g} из 100 (для ступени 3 нужно от 40)` : ''].filter(Boolean).join('; ').replace(/^./, (c) => c.toUpperCase()) + '.';
    case 3: return [res && `${res} — от 3 есть`, g !== null ? `общая оценка ${g} из 100${g < 75 ? ' (для ступени 4 нужно от 75)' : ''}` : ''].filter(Boolean).join('; ').replace(/^./, (c) => c.toUpperCase()) + '.';
    case 4: return [res && `${res} — от 6 есть`, g !== null ? `общая оценка ${g} из 100 — от 75 есть` : '', 'каждое направление от 60'].filter(Boolean).join('; ').replace(/^./, (c) => c.toUpperCase()) + '.';
    default: {
      const c = v.l5;
      if (!c) return null;
      if (c.capitalOnly && !c.ok) return `Денег хватит больше чем на ${Math.floor(c.lifeReserve.have / 12)} лет обычной жизни даже без дохода.`;
      return `Денег на ${nfDown(c.lifeReserve.have)} мес. обычной жизни; на обязательное уходит ${Math.round((c.essentialShare.have ?? 0) * 100)} % дохода; откладываешь ${Math.round(Math.max(0, c.savingRate.have ?? 0) * 100)} % — и так почти каждый месяц.`;
    }
  }
}

defineSheet('ladder', () => {
  const v = positionNow();
  if (v.status !== 'ok') return null;
  const more = levelMore(v);
  return {
    title: 'Ступени',
    body: h('div', { class: 'stack' },
      h('ol', { class: 'pos-ladder-list' },
        [...v.ladder].reverse().map((s) => h('li', { class: s.current ? 'is-current' : '' },
          h('div', { class: 'pos-ladder-name' }, `${s.level}. ${s.name}`, s.current ? h('span', { class: 'chip static' }, 'ты здесь') : null),
          h('div', { class: 'muted' }, s.meaning)))),
      ...more),
  };
});

/** Лесенка из пяти ступенек (D2): пройденные и текущая закрашены, следующая — пунктиром. */
function ladderBars(v: PositionView): HTMLElement {
  const lvl = v.level ?? 0;
  return h('span', { class: 'pos-bars', 'aria-hidden': 'true' }, [1, 2, 3, 4, 5].map((n) => h('span', { class: n <= lvl ? 'on' : n === lvl + 1 ? 'next' : '' })));
}

/** Три направления в одну строку: число и полоска с чертой 60. Нажатие — из чего направление (лист `direction`). */
function directionsRow(v: PositionView): HTMLElement | null {
  if (!v.directions.length) return null;
  return h(
    'div',
    { class: 'pos-dirs', 'data-tour': 'dirs' },
    v.directions.map((d) => {
      const low = d.score !== null && d.score < 60;
      return h(
        'a',
        { class: `pos-dir${low ? ' low' : ''}`, href: sheetHref('direction', d.id), 'aria-label': `${d.name}: ${d.score === null ? 'мало данных' : `${scoreWord(d.score)}, ${shownScore(d.score)} из 100`}. Из чего состоит` },
        h('span', { class: 'pd-name' }, d.name),
        h('span', { class: 'pd-val' }, d.score === null ? '—' : String(shownScore(d.score))),
        h('span', { class: 'dbar', 'aria-hidden': 'true' }, d.score === null ? null : h('span', { class: 'dfill', style: `width:${Math.max(0, Math.min(100, d.score))}%` }), h('span', { class: 'dtick' })),
        d.score === null || !d.reliable ? h('span', { class: 'pd-note' }, 'данных мало') : null,
      );
    }),
  );
}

/**
 * Карточка ступени (D2): компактная лесенка, название и смысл одной строкой, под ними три направления.
 * Заголовок — ссылка на лист «Ступени» (все пять и пояснения); отдельных кнопок нет (старые были 36 px).
 */
function levelCard(v: PositionView): HTMLElement {
  const key: HTMLElement[] = [];
  if (v.onBorder.length) key.push(h('p', { class: 'pos-note' }, 'Ты на границе ступеней: небольшое изменение сдвинет ступень.'));
  if (v.l4Unconfirmed) key.push(h('p', { class: 'pos-note' }, `По оценке это «${LEVEL_NAMES[4]}», но данных пока мало — показана ступень ниже.`));
  if (v.held) key.push(h('p', { class: 'pos-note' }, `${v.held}.`));
  return h(
    'div',
    { class: 'card stack pos-level-card' },
    h(
      'a',
      { class: 'pos-head', href: sheetHref('ladder'), 'data-tour': 'level', 'aria-label': `${v.level === null ? 'Ступень не определена' : `Ступень ${v.level} из 5`}: ${v.levelName ?? ''}. Все ступени` },
      ladderBars(v),
      h('span', { class: 'pos-head-text' },
        h('span', { class: 'pos-level-code' }, v.level === null ? '—' : `Ступень ${v.level} из 5`, v.preliminary ? h('span', { class: 'chip static' }, 'предварительно') : null),
        h('span', { class: 'pos-level-name' }, v.levelName ?? 'Оценить нечем'),
        v.levelMeaning ? h('span', { class: 'pos-meaning' }, `${meaningOf(v)}.`) : null),
      h('span', { class: 'pos-head-go', 'aria-hidden': 'true' }, '›'),
    ),
    ...key,
    trustLine(v),
    directionsRow(v),
  );
}

/** При долговой спирали на ступени 2 фраза «денег хватает» стояла рядом с тревожными признаками — говорим одним тоном (К4 аудита UX). Если расходы больше доходов, это уже сказано в самой фразе (D173). */
function meaningOf(v: PositionView): string {
  if (v.level === 2 && v.spiral.spiral && !(v.levelMeaning ?? '').startsWith('Расходы больше доходов')) return 'Долги растут быстрее, чем гасятся. Начни с одного платежа';
  return v.levelMeaning ?? '';
}

/**
 * «Главное сейчас» (D6, дизайн A+): на ступени 1 с дефицитом — одно спокойное предложение про разницу и выход «Что можно сделать».
 * Без упрёков и без придуманных шагов: сумма из `runway`, ссылка на уже существующий «Где сэкономить».
 */
function mainNowBlock(v: PositionView): HTMLElement | null {
  const r = v.runway;
  if (v.level !== 1 || r.status !== 'deficit' || r.deficit <= 0) return null;
  return h(
    'section',
    { class: 'pos-now', 'aria-label': 'Главное сейчас' },
    h('div', { class: 'pn-k' }, 'Главное сейчас'),
    h('div', { class: 'pn-t' }, `Расходы больше доходов на ${approx(r.deficit)} в месяц`),
    h('div', { class: 'pn-s' }, leftText(r.months)),
    flowBars(v),
    h('a', { class: 'btn wide', href: sheetHref('road-how') }, 'Что можно сделать'),
  );
}

/** Две полоски «Доход / Расходы» в месяц и, если платежи по долгам берут треть дохода и больше, одна спокойная строка про это (D6). Числа — `v.flow`. */
function flowBars(v: PositionView): HTMLElement | null {
  const f = v.flow;
  if (!f || !(f.income > 0) || !(f.spending > 0)) return null;
  const top = Math.max(f.income, f.spending);
  const bar = (label: string, x: number, cls: string): HTMLElement =>
    h('div', { class: 'pn-bar' },
      h('div', { class: 'pn-bar-row' }, h('span', null, label), h('strong', null, approx(x))),
      h('span', { class: 'dbar', 'aria-hidden': 'true' }, h('span', { class: `dfill ${cls}`, style: `width:${Math.round((x / top) * 100)}%` })));
  const share = f.obligations / f.income;
  return h('div', { class: 'pn-flow' },
    bar('Доход в месяц', f.income, 'inc'),
    bar('Расходы в месяц', f.spending, 'exp'),
    share >= 1 / 3 ? h('div', { class: 'pn-s' }, `Платежи по долгам — ${Math.round(share * 100)} % дохода`) : null);
}

/** Один маленький первый шаг, когда есть долговая спираль или просрочки (К4 аудита UX). */
function firstStepBlock(v: PositionView): HTMLElement | null {
  if (!v.spiral.spiral && v.overdue <= 0) return null;
  const title = v.overdue > 0 ? `Отметь, какие из ${v.overdue} ${v.overdue === 1 ? 'платежа' : 'платежей'} уже оплачены` : 'Посмотри платежи по долгам';
  const subText = v.overdue > 0 ? 'Возможно, часть из них просто не попала в операции, и просрочки на самом деле нет.' : 'Выбери один платёж, с которого начнёшь.';
  return h('div', { class: 'stack' }, sub('Сейчас важнее всего'), rows(row({ title, sub: subText, href: '#/debts', cls: 'warn' })));
}

/** Цель запаса для следующей ступени: 3 месяца к «Есть подушка», 6 — к «Защищён от ударов». null — следующая ступень не про запас на необходимое. */
function pathTarget(v: PositionView): ReserveTarget | null {
  if (v.level === null || v.level > 3 || !v.next) return null;
  return v.level <= 2 ? 3 : 6;
}

/** «Чтобы подняться, нужно три условия»: число словами, пока их не больше четырёх. */
function needLine(n: number): string {
  const word = ['', 'одно условие', 'два условия', 'три условия', 'четыре условия', 'пять условий'][n];
  return word ? `Чтобы подняться, нужно ${word}` : 'Чтобы подняться, нужно:';
}

/**
 * «План» (D217; раньше «Твоя дорога»): пройденные ступени строкой, «ты здесь», следующая ступень. Над условиями — шкала общей оценки
 * (не галочка: её нельзя «выполнить»), ниже — условия-факты с цифрами и одна кнопка «Как дойти». Всё из `roadOf`.
 */
function roadBlock(v: PositionView): HTMLElement | null {
  const m = roadOf(v);
  if (!m) return null;
  const node = (text: string, cls: string): HTMLElement => h('span', { class: `rd-node ${cls}`, 'aria-hidden': 'true' }, text);
  const cond = (c: RoadCond): HTMLElement =>
    h('div', { class: `rd-cond${c.done ? ' ok' : ''}` },
      h('span', { class: 'rd-dot', 'aria-hidden': 'true' }, c.done ? '✓' : ''),
      h('div', { class: 'rd-cond-main' },
        h('div', { class: 'rd-cond-row' }, h('span', { class: 'rd-cond-title' }, c.title), c.value ? h('span', { class: 'rd-cond-val' }, c.value) : null),
        c.ratio !== null && !c.done ? h('span', { class: 'dbar', 'aria-hidden': 'true' }, h('span', { class: 'dfill', style: `width:${Math.round(c.ratio * 100)}%` })) : null,
        c.hint && !c.done ? h('span', { class: 'rd-cond-hint' }, c.hint) : null,
      ),
    );
  const sc = m.next.score;
  const gauge = sc
    ? h('div', { class: `rd-score${sc.done ? ' ok' : ''}` },
        h('div', { class: 'rd-cond-row' }, h('span', { class: 'rd-cond-title' }, 'Общая оценка'), h('span', { class: 'rd-cond-val' }, sc.done ? `${sc.have} из 100 · хватает` : `${sc.have} из 100 · нужно ${sc.need}`)),
        h('span', { class: 'dbar rd-score-bar', 'aria-hidden': 'true' }, h('span', { class: 'dfill', style: `width:${Math.max(0, Math.min(100, sc.have))}%` }), h('span', { class: 'dtick', style: `left:${sc.need}%` })),
        sc.hint ? h('span', { class: 'rd-cond-hint' }, sc.hint) : null)
    : null;
  const planned = getState().settings.plannedEvents.find((e) => e.title.startsWith(ROUTE_PLAN_PREFIX));
  const target = pathTarget(v);
  const open = (): void => setRouteTarget(target);
  return h(
    'section',
    { class: 'pos-road', 'aria-label': 'План', 'data-tour': 'path' },
    h('div', { class: 'pr-k' }, 'План'),
    h(
      'ol',
      { class: 'road' },
      m.passed ? h('li', { class: 'rd past' }, node('✓', 'past'), h('div', { class: 'rd-body' }, m.passed)) : null,
      h('li', { class: 'rd here' }, node(String(m.current.level), 'here'), h('div', { class: 'rd-body' }, h('span', { class: 'rd-name' }, m.current.name), h('span', { class: 'rd-chip' }, 'ты здесь'))),
      h(
        'li',
        { class: 'rd next' },
        node(String(m.next.level), 'next'),
        h('div', { class: 'rd-card' },
          h('div', { class: 'rd-name' }, m.next.name),
          m.next.conds.length ? h('div', { class: 'rd-sub' }, needLine(m.next.conds.length)) : null,
          gauge,
          m.next.conds.length ? h('div', { class: 'rd-conds' }, ...m.next.conds.map(cond)) : null,
          planned ? h('div', { class: 'okline' }, `В плане: «${planned.title}»`) : null,
          h('a', { class: 'btn wide', href: sheetHref('road-how'), onclick: open }, 'Как дойти'),
        ),
      ),
      m.rest.length ? h('li', { class: 'rd far' }, node(String(m.rest[0]!.level), 'far'), h('div', { class: 'rd-body muted' }, `Дальше: ${m.rest.map((x) => x.name).join(' → ')}`)) : null,
    ),
  );
}

/**
 * Доход, срок которого прошёл (D214): без ответа приложение считает, что дохода больше нет, и «Долговая нагрузка» от этого падает.
 * Три ответа: продолжается (убираем срок), закончился (запоминаем ответ), пришёл другой доход (новый доход через «Планирую»).
 */
function endedIncomeBlock(v: PositionView): HTMLElement | null {
  if (!v.endedIncome.length) return null;
  const dmy = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  const cards = v.endedIncome.slice(0, 2).map((x) =>
    h('section', { class: 'warnline stack', 'aria-label': 'Доход закончился' },
      h('strong', null, `«${x.title}» (${money(x.amount / 100)} в месяц) закончился ${dmy(x.end)}`),
      h('p', { class: 'muted' }, 'Пока ты не ответишь, приложение считает, что этого дохода больше нет, и оценка долговой нагрузки строится без него. Что дальше?'),
      h('div', { class: 'chips wrap' },
        h('button', { class: 'chip', type: 'button', onclick: () => void act((s) => ({ ...s, settings: { ...s.settings, incomeSchedule: s.settings.incomeSchedule.map((i) => { if (i.id !== x.id) return i; const { end: _end, ...rest } = i; return rest; }) } }), `«${x.title}» снова считается действующим`) }, 'Продолжается'),
        h('button', { class: 'chip', type: 'button', onclick: () => void act((s) => ({ ...s, settings: { ...s.settings, incomeEndedAnswered: [...new Set([...(s.settings.incomeEndedAnswered ?? []), x.id])] } }), `Записано: «${x.title}» закончился`) }, 'Закончился, дохода нет'),
        h('a', { class: 'chip', href: sheetHref('plan', `job@${today()}`) }, 'Теперь другой доход'),
      ),
    ),
  );
  return h('div', { class: 'stack' }, ...cards);
}

function warningsBlock(v: PositionView): HTMLElement | null {
  if (!v.l4Warnings.length) return null;
  return h(
    'div',
    { class: 'warnline stack' },
    h('strong', null, `Это «${v.levelName ?? LEVEL_NAMES[4]}», но есть уязвимость`),
    v.l4Warnings.map((w) => h('div', null, w.text)),
    h('small', { class: 'hint' }, 'Ступень от этого не меняется: это объяснение, где профиль хрупкий.'),
  );
}

/** Слово рядом с очками (аудит 9, U4): «92» само по себе ничего не говорит. Черта 60 — порог уровня «Защищён от ударов». */
export function scoreWord(score: number): string {
  if (score >= WEAK_NONE_FROM) return 'сильно';
  if (score >= 60) return 'достаточно';
  if (score >= 40) return 'слабо';
  return 'мало';
}

/** Срок словами: 12 → «год», 24 → «2 года». */
const termWord = (n: number): string => (n === 12 ? 'год' : n === 24 ? '2 года' : `${n} мес.`);

/**
 * «Как дойти» (D217): одна страница вместо «Посчитать путь» и «Как выполнить» (они дублировали друг друга, а «Из А в Б» был отдельным листом).
 * Шаги по порядку: сначала выйти в плюс (пока минус, запас тает), потом запас, для ступени 5 — доля обязательного и сколько откладывать,
 * в конце — что тянет оценку вниз. Числа из `roadHowOf` (`routeTo`, `savingOptions`, `PositionView`) и `reserveRouteParts`; ничего не выдумано.
 * Тот же лист открывается как `a-to-b` (старые ссылки «Набрать запас»).
 */
function howSheet(): { title: string; body: HTMLElement } {
  const v = positionNow();
  const st = getState();
  const t = today();
  if (v.status !== 'ok') return { title: 'Как дойти', body: h('div', { class: 'stack' }, ...reserveRouteParts(null, false)) };
  const target = pathTarget(v);
  const how = roadHowOf(v, target === null ? null : routeTo(st, t, target), savingOptions(st, t));
  const m = roadOf(v);
  const parts: (HTMLElement | null)[] = [];
  let n = 0;
  const stepHead = (title: string): HTMLElement => sub(`Шаг ${++n}. ${title}`);
  if (m) parts.push(h('p', { class: 'muted' }, `Ты на ступени ${m.current.level} «${m.current.name}». Следующая — «${m.next.name}». Шаги по порядку: следующий имеет смысл, когда сделан предыдущий.`));
  const savingsParts = (): void => {
    if (!how.savings.length) return;
    parts.push(
      sub(how.deficit ? 'Где траты крупнее всего' : 'На чём можно сэкономить'),
      rows(how.savings.map((x) => row({ title: x.title, sub: `уходит ${fmtShort(x.monthly)} в месяц; на ${SAVING_CUT_PCT} % меньше — ещё +${fmtShort(x.cutPerMonth)} в месяц`, href: sheetHref('save-cat', x.categoryId) }))),
      h('div', { class: 'chips wrap' }, h('a', { class: 'chip', href: sheetHref('save-where') }, 'Все траты'), h('a', { class: 'chip', href: sheetHref('plan', 'job') }, 'Добавить доход'), v.spiral.spiral ? h('a', { class: 'chip', href: '#/debts' }, 'Долги') : null),
    );
  };
  if (how.deficit) {
    parts.push(
      stepHead('Выйти в плюс'),
      h('div', { class: 'card stack tight' },
        h('strong', null, `Сейчас расходы больше доходов на ≈ ${fmtShort(Math.round(how.deficit.monthly * 100) as never)} в месяц`),
        h('p', null, 'Пока так, деньги тают и откладывать бесполезно: любая добавка уходит на дыру. Закрыть её можно двумя путями — меньше тратить или больше получать. Ниже — где траты крупнее всего.'),
        v.spiral.spiral ? h('p', { class: 'muted' }, 'Если для этого берёшь новые долги — начни с того, чтобы не брать следующий: «Долги» покажут, какой платёж закрыть первым.') : null),
    );
    savingsParts();
  }
  if (target !== null && v.money.reserveEssentialMonths < target) {
    parts.push(stepHead(`Запас на ${target} месяцев`), ...reserveRouteParts(target, how.deficit !== null));
    if (!how.deficit) savingsParts();
  }
  if (v.level === 4 && v.l5) {
    const c = v.l5;
    const need = v.flow ? v.flow.spending : 0;
    if (!c.lifeReserve.ok) parts.push(stepHead('Деньги на год обычной жизни'), h('div', { class: 'card stack tight' },
      h('strong', null, `Сейчас — на ${(Math.floor(c.lifeReserve.have * 10) / 10).toString().replace('.', ',')} мес. обычной жизни, нужно ${c.lifeReserve.need}`),
      need > 0 ? h('p', null, `Не хватает ${approx((c.lifeReserve.need - c.lifeReserve.have) * need)}. Считается со всеми обычными тратами — ${approx(need)} в месяц, — а не только с необходимыми.`) : null));
    if (!c.essentialShare.ok && c.essentialShare.have !== null) parts.push(stepHead('Обязательное — до половины дохода'), h('div', { class: 'card stack tight' },
      h('strong', null, `Сейчас на обязательное уходит ${pct(c.essentialShare.have)} дохода`),
      h('p', null, `Еда, жильё, связь, дорога и платежи по долгам. Снизить долю можно ростом дохода или меньшими обязательными тратами${(v.flow?.obligations ?? 0) > 0 ? '; когда кончатся платежи по кредитам, доля упадёт сама' : ''}.`)));
    if (!c.savingRate.ok || !c.habit.ok) parts.push(stepHead('Откладывать каждый месяц'), h('div', { class: 'card stack tight' },
      h('strong', null, c.savingRate.have === null ? 'Истории пока мало, чтобы проверить' : `Сейчас остаётся ${pct(Math.max(0, c.savingRate.have))} дохода, нужно от ${pct(c.savingRate.min)}`),
      h('p', null, 'И так — хотя бы в 5 из 6 последних месяцев. Проще всего — отложить в копилку сразу в день дохода.')));
  }
  if (how.weak.length && v.level !== null && v.level < 4) {
    parts.push(
      sub('Что тянет оценку вниз'),
      rows(how.weak.map((w) => row({ title: w.label, sub: INDICATOR_HINTS[w.id] ?? w.directionName, value: String(shownScore(w.score)), href: sheetHref('direction', w.direction) }))),
    );
  }
  if (!m && v.level === 5) parts.push(h('div', { class: 'okline' }, 'Это верхняя ступень. Следи, чтобы обязательное не росло быстрее дохода и запас не таял.'));
  if (n === 0 && !how.weak.length && v.level !== 5) parts.push(h('div', { class: 'okline' }, 'Условия, которые зависят от денег, выполнены. Остаётся общая оценка — она растёт сама, когда деньги копятся месяц за месяцем.'));
  return { title: 'Как дойти', body: h('div', { class: 'stack' }, ...parts) };
}
defineSheet('road-how', () => howSheet());
defineSheet('a-to-b', () => howSheet());

/** Что измеряет каждый показатель и что значит 0 и 100 — простыми словами (аудит UX: «откуда у направления 100?»). */
const INDICATOR_HINTS: Readonly<Record<string, string>> = {
  N1: 'На сколько месяцев хватит денег без дохода. 100 — запас большой, 0 — почти нет.',
  N2: 'Какую часть дохода остаётся после трат (по последним 3 месяцам). 100 — откладываешь больше трети, 0 — всё уходит.',
  N3: 'Сколько дохода уходит на платежи по долгам, как велик долг без залога и, если ипотека привязана к жилью, какую часть жилья она занимает. 100 — долгов нет, 0 — долги тяжёлые.',
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

/** Из чего состоит направление: вопрос, на который оно отвечает, оценка и показатели с пояснениями (лист по нажатию на направление). */
defineSheet('direction', (id) => {
  const v = positionNow();
  const d = v.status === 'ok' ? v.directions.find((x) => x.id === id) : undefined;
  if (!d) return null;
  return {
    title: d.name,
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted' }, d.question),
      d.score === null
        ? h('p', null, 'Оценить пока нечем: данных мало.')
        : h('p', null, `${scoreWord(d.score)[0]!.toUpperCase()}${scoreWord(d.score).slice(1)} · ${shownScore(d.score)} из 100${d.reliable ? '' : ' · данных мало'}. Оранжевая черта на полоске — 60: от неё направление считается достаточным.`),
      rows(...d.indicators.map((i) => row({ title: i.label, sub: INDICATOR_HINTS[i.id], value: i.score === null ? 'пока неизвестно' : `${scoreWord(i.score)} · ${shownScore(i.score)}`, chevron: false })))),
  };
});

/** Слабое место и что нужно для следующей ступени — одной карточкой: заголовок крупно, показатель — плашкой (D191). */
function weakBlock(v: PositionView): HTMLElement | null {
  // ступень 5 — верхняя (D216): говорим, что держит её, а не «слабое место»
  if (v.level === 5) {
    return h('div', { class: 'pos-focus', 'data-tour': 'weak' },
      h('div', { class: 'pf-k' }, 'Верхняя ступень'),
      h('p', { class: 'muted' }, 'Держится на двух вещах: деньгах на год обычной жизни и свободе в каждой зарплате. Если обязательное начнёт расти быстрее дохода, ступень это покажет.'));
  }
  const next = v.next ?? null;
  // D210: оценено, но слабого места нет (лучший из действуемых показателей слабого направления от WEAK_NONE_FROM) — говорим об этом, а не называем хорошее слабым
  const noWeak = !v.weak && v.status === 'ok' && v.g !== null;
  if (!v.weak && !noWeak && !next && !v.limitsFired.length) return null;
  return h(
    'div',
    { class: 'pos-focus', 'data-tour': 'weak' },
    v.weak
      ? h('div', { class: 'pf-row' },
          h('div', null, h('div', { class: 'pf-k' }, 'Слабое место'), h('div', { class: 'pf-v' }, v.weak.directionName)),
          v.weak.indicator ? h('span', { class: 'pf-chip' }, `${v.weak.indicator.label} · ${shownScore(v.weak.indicator.score)}`) : null)
      : noWeak
        ? h('div', { class: 'pf-row' }, h('div', null, h('div', { class: 'pf-k' }, 'Слабое место'), h('div', { class: 'pf-v' }, 'Слабых мест нет')))
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
      h('a', { class: 'cell', href: sheetHref('reserve-info') }, h('div', { class: 'k' }, 'Запас'), h('div', { class: 'v' }, v.essentialUnknown ? '—' : mo(m.reserveEssentialMonths)), h('div', { class: 'cs' }, v.essentialUnknown ? 'отметь, что обязательно ›' : 'без дохода ›')),
      spendable ? h('div', { class: 'cell' }, h('div', { class: 'k' }, 'Снять за месяц'), h('div', { class: 'v' }, short(m.spendable)), h('div', { class: 'cs' }, m.spendable > m.total ? 'платежи месяца вычтены, остаток долгов — нет' : 'после платежей и трат')) : null,
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
  // С7 (D164): то же уже сказано строкой «Запас» выше — второй раз не повторяем
  if (r.status === 'no_deficit') return null;
  // на ступени 1 это уже сказано в «Главное сейчас» с кнопкой
  if (v.level === 1) return null;
  // D217: не диагноз, а что делать — сколько нужно убрать в месяц и куда нажать (раньше «А если…» со списком сценариев без действия)
  const spend = v.flow?.spending ?? 0;
  const cutPct = spend > 0 ? Math.ceil((r.deficit / spend) * 100) : null;
  return h(
    'div',
    { class: 'stack' },
    sub('Если ничего не менять', info('runway')),
    rows(row({ title: `Расходы больше доходов на ${money(r.deficit)} в месяц`, sub: leftText(r.months), chevron: false, cls: 'warn' })),
    h('p', null, cutPct !== null && cutPct <= 100 ? `Чтобы выйти в ноль, нужно тратить на ${cutPct} % меньше или получать на ${approx(r.deficit)} в месяц больше.` : `Чтобы выйти в ноль, нужно получать на ${approx(r.deficit)} в месяц больше.`),
    h('a', { class: 'btn wide', href: sheetHref('road-how') }, 'Что можно сделать'),
  );
}

function spiralBlock(v: PositionView): HTMLElement | null {
  const items: HTMLElement[] = [];
  // D217: без «двух из трёх проверок» — что видно и куда нажать
  if (v.spiral.spiral) items.push(row({ title: 'Долги растут быстрее, чем гасятся', sub: 'Похоже, новые займы уходят на старые платежи или на жизнь. Первый шаг — не брать следующий и выбрать один платёж, который закрыть первым.', href: '#/debts', cls: 'warn' }));
  if (v.overdue > 0) items.push(row({ title: `Есть просроченные платежи: ${v.overdue}`, sub: 'платёж по графику есть, а в операциях его нет — отметь, какие уже оплачены', href: '#/debts', cls: 'warn' }));
  return items.length ? rows(...items) : null;
}

defineSheet('profile-more', () => {
  const v = positionNow();
  if (v.status !== 'ok') return null;
  const parts = [housingBlock(v), runwayBlock(v)].filter((x): x is HTMLElement => x !== null);
  if (!parts.length) parts.push(h('p', { class: 'muted' }, 'Жилья и закрытых активов нет, расходы не больше доходов — добавить нечего.'));
  return { title: 'Подробнее о профиле', body: h('div', { class: 'stack' }, ...parts) };
});

/** Внизу экрана: «Как посчитано» и подсказка «Как читать экран» (раньше — кнопка 36 px в карточке ступени). */
function footNote(): HTMLElement {
  return h('div', { class: 'foot-note' }, explainLink('position'), h('button', { class: 'foot-act', type: 'button', onclick: () => void profileTour() }, 'Как читать экран'));
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
  const ei = endedIncomeBlock(v);
  if (ei) root.append(ei);
  // первый заход на «Профиль» — подсказка по блокам сама, один раз (не поверх окна «Что нового»)
  const demo = getDemo();
  autoTour('profile', '#/position', demo ? () => personaTour(demo.id) : profileTour);
  // ступень 1: тёплый тон (оранжевый вместо бирюзового) и «Главное сейчас» без упрёков (D6)
  if (v.level === 1) root.classList.add('tone-warm');
  const mn = mainNowBlock(v);
  if (mn) root.append(mn);
  const fs = firstStepBlock(v);
  if (fs) root.append(fs);
  const road = roadBlock(v);
  if (road) root.append(road);
  const w = warningsBlock(v);
  if (w) root.append(w);
  if (v.essentialMissing) root.append(rows(row({ title: 'Отметь, что обязательно', sub: 'ни одна трата не отмечена как «без этого не прожить» — запас считается неточно', href: '#/markup', cls: 'warn' })));
  // когда есть план, слабое место уже сказано подсказкой под оценкой, а ограничения — условиями; отдельный блок только без плана (ступень 5)
  const wk = road ? null : weakBlock(v);
  if (wk) root.append(wk);
  root.append(moneyBlock(v));
  const sp = spiralBlock(v);
  // простой режим (D185): жильё, «если доход пропадёт» и независимость — за одной строкой «Подробнее»; тревожные признаки (спираль, просрочки) остаются на виду
  if (isSimpleMode(getState().settings)) {
    if (sp) root.append(sp);
    root.append(rows(row({ title: 'Подробнее', sub: 'имущество и если ничего не менять', href: sheetHref('profile-more') })));
    root.append(footNote());
    return root;
  }
  const hb = housingBlock(v);
  if (hb) root.append(hb);
  const rw = runwayBlock(v);
  if (rw) root.append(rw);
  if (sp) root.append(sp);
  root.append(footNote());
  return root;
}

/** Строка-карточка для «Обзора»: уровень и ссылка на полный экран. null — показывать нечего. */
export function positionRow(): HTMLElement | null {
  const v = positionNow();
  if (v.status === 'no_data' || v.level === null) return null;
  // один запас на «Обзоре» (К4, этап 2): та же цифра, что в условиях ступени
  const reserve = !v.essentialUnknown && v.money.reserveEssentialMonths > 0 ? `запас ${mo(v.money.reserveEssentialMonths)}` : '';
  const note = !v.reconcileOk ? 'предварительно — сверка не сошлась' : v.preliminary ? 'предварительно — данных пока мало' : '';
  return rows(row({ title: `Ступень ${v.level} · ${v.levelName}`, sub: [reserve, note].filter(Boolean).join(' · ') || undefined, href: '#/position' }));
}

export { sheetHref };
