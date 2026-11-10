/**
 * «Положение» (T11): уровень, три направления, слабое место, деньги, запас, независимость.
 * Экран ничего не считает: всё берётся из `positionViewOf` (engine/position/view.ts) и рисуется в порядке важности для телефона.
 * Слова без внутренних терминов; коды показателей (N1, V2…) на экране не показываются.
 */
import { DESIRED_LABEL, INDEPENDENCE_TEXTS, INDICATOR_LABELS, step, type Explanation, type PositionView } from '../../engine/index';
import { h } from '../dom';
import { explainLink, registerExplain } from '../explain';
import { positionNow } from '../ctx';
import { radar } from '../radar';
import { fmt, info, nWord, row, rows, sub } from '../ui';
import { sheetHref } from '../main';

const nf = (x: number, d = 1): string => x.toFixed(d).replace('.', ',');
const money = (tenge: number) => fmt(Math.round(tenge * 100) as never);
const pct = (x: number): string => `${Math.round(x * 100)} %`;
const mo = (x: number): string => (x >= 600 ? 'больше 50 лет' : `${nf(x)} мес.`);
const SHORT = { N: 'Сейчас', V: 'Вектор', F: 'Будущее' } as const;

function months(m: number | null): string {
  if (m === null) return 'не определить';
  return m >= 600 ? 'больше 50 лет' : `${Math.round(m)} мес.`;
}

// ───────────────────────── «Как посчитано» ─────────────────────────

function explanation(v: PositionView): Explanation {
  if (v.status === 'no_data') return [step('position.no_data', 'В бэкапе нет операций, положение оценить нечем', { level: 'warn' })];
  const out: Explanation = [];
  out.push(step('position.level', `Уровень: ${v.level === null ? 'не определён' : `L${v.level} «${v.levelName}»`}${v.g !== null ? `, общая оценка ${nf(v.g)} из 100` : ''}`));
  for (const d of v.directions) {
    out.push(step(`position.dir.${d.id}`, `${d.name}: ${d.score === null ? 'оценить нечем' : `${nf(d.score)} из 100`}${d.reliable ? '' : ' (данных мало)'}`));
    for (const i of d.indicators) out.push(step(`position.ind.${i.id}`, `${i.label}: ${i.score === null ? 'пока неизвестно' : `${nf(i.score)} из 100`}`, { detail: true }));
  }
  for (const l of v.limitsFired) out.push(step(`position.limit.${l.id}`, `Ограничитель: ${l.text}`, { level: 'warn' }));
  if (v.range) out.push(step('position.range', `Диапазон по неизвестному: от ${nf(v.range.low)} до ${nf(v.range.high)}${v.range.showPoint ? `, ориентир ${nf(v.range.point)}` : ''}`));
  out.push(step('position.confidence', `Достоверность данных: ${pct(v.confidence)}${v.preliminary ? ' — уровень предварительный' : ''}`));
  return out;
}
registerExplain('position', 'Как посчитано: «Положение»', () => explanation(positionNow()));

// ───────────────────────── блоки ─────────────────────────

function levelCard(v: PositionView): HTMLElement {
  const isL5 = v.basis === 'independence';
  const lines: (HTMLElement | null)[] = [];
  if (v.range && v.rangeLevels) {
    lines.push(
      h('p', { class: 'muted' },
        v.range.levelsCovered === 1 && v.rangeLevels.low === v.rangeLevels.high
          ? `Часть данных неизвестна, но на уровень это не влияет: оценка от ${Math.round(v.range.low)} до ${Math.round(v.range.high)}.`
          : `Часть данных неизвестна: оценка от ${Math.round(v.range.low)} до ${Math.round(v.range.high)}, то есть от «${v.rangeLevels.low}» до «${v.rangeLevels.high}».${v.range.showPoint ? ` Ориентир — ${Math.round(v.range.point)}.` : ' Точнее сказать нельзя.'}`),
    );
  }
  if (v.onBorder.length) lines.push(h('p', { class: 'muted' }, 'Ты на границе уровней: небольшое изменение сдвинет уровень.'));
  if (v.l4Unconfirmed) lines.push(h('p', { class: 'muted' }, 'По оценке это «Безопасность», но данных пока мало, поэтому показан уровень ниже. Данные накопятся — уровень подтвердится.'));
  return h(
    'div',
    { class: 'card stack pos-level-card' },
    h('div', { class: 'pos-level-code' }, v.level === null ? '—' : `L${v.level}`, v.preliminary ? h('span', { class: 'chip static' }, 'предварительно') : null),
    h('div', { class: 'pos-level-name' }, v.levelName ?? 'Оценить нечем'),
    isL5 ? h('p', { class: 'muted' }, INDEPENDENCE_TEXTS.l5Label) : v.g !== null ? h('p', { class: 'muted' }, `Общая оценка ${Math.round(v.g)} из 100`) : null,
    ...lines,
  );
}

function warningsBlock(v: PositionView): HTMLElement | null {
  if (!v.l4Warnings.length) return null;
  return h(
    'div',
    { class: 'warnline stack' },
    h('strong', null, 'Это «Безопасность», но есть уязвимость'),
    v.l4Warnings.map((w) => h('div', null, w.text)),
    h('small', { class: 'hint' }, 'Уровень от этого не меняется: это объяснение, где положение хрупкое.'),
  );
}

function directionsBlock(v: PositionView): HTMLElement {
  const [n, vv, f] = v.directions;
  const desc = v.directions.map((d) => `${d.name}: ${d.score === null ? 'оценить нечем' : Math.round(d.score)}`).join('; ');
  return h(
    'div',
    { class: 'stack' },
    radar([{ label: SHORT.N, score: n!.score }, { label: SHORT.V, score: vv!.score }, { label: SHORT.F, score: f!.score }], `Три направления положения. ${desc}`),
    h('p', { class: 'one-line' }, 'Пунктир — уровень 60: каждое направление должно его достичь, чтобы получить «Безопасность».'),
    rows(
      ...v.directions.map((d) =>
        h('details', { class: 'fold row-fold', 'data-key': `position:${d.id}` },
          h('summary', null, h('span', { class: 'rf-title' }, d.name), h('span', { class: 'rf-val' }, d.score === null ? 'мало данных' : `${Math.round(d.score)}${d.reliable ? '' : ' · данных мало'}`)),
          h('p', { class: 'muted' }, d.question),
          rows(...d.indicators.map((i) => row({ title: i.label, value: i.score === null ? 'пока неизвестно' : String(Math.round(i.score)), chevron: false })))),
      ),
    ),
  );
}

function weakBlock(v: PositionView): HTMLElement | null {
  const items: (HTMLElement | null)[] = [];
  if (v.weak) {
    items.push(row({ title: `Слабое место: ${v.weak.directionName}`, sub: v.weak.indicator ? `самое слабое в нём — «${v.weak.indicator.label}», ${Math.round(v.weak.indicator.score)} из 100` : undefined, chevron: false }));
  }
  if (v.next) items.push(row({ title: `До «${v.next.name}» не хватает ${nWord(Math.ceil(v.next.shortfall), 'очко', 'очка', 'очков')}`, sub: 'очки — по шкале 0–100', chevron: false }));
  for (const l of v.limitsFired) items.push(row({ title: 'Сдерживает уровень', sub: l.text, chevron: false, cls: 'warn' }));
  return items.length ? rows(...items) : null;
}

function moneyBlock(v: PositionView): HTMLElement {
  const m = v.money;
  return h(
    'div',
    { class: 'stack' },
    sub('Деньги', info('capitalTwo')),
    rows(
      row({ title: 'Всего капитал', sub: 'всё, что у тебя есть, минус долги', value: money(m.total), chevron: false }),
      // вторая цифра — только если она заметно отличается (жильё, вклады на срок, долги людям); иначе это тот же капитал второй раз
      Math.abs(m.total - m.spendable) > 0.05 * Math.max(Math.abs(m.total), 1)
        ? row({
            title: 'Деньги, которые можно потратить',
            // «из капитала» только когда они меньше капитала; при долгах и рассрочках они бывают больше капитала: капитал уже уменьшен на то, что ещё предстоит выплатить
            sub: m.spendable < m.total ? 'можно снять за 30 дней; остальное — жильё, вклады на срок или долги людям' : 'на счетах, доступно за 30 дней; рассрочки и долги впереди из капитала уже вычтены',
            value: money(m.spendable),
            chevron: false,
          })
        : null,
      row({ title: 'Запас денег', sub: `по обычным расходам ${mo(m.reserveLifestyleMonths)} · по необходимым ${mo(m.reserveEssentialMonths)}`, chevron: false }),
    ),
  );
}

function runwayBlock(v: PositionView): HTMLElement | null {
  const r = v.runway;
  if (r.status === 'no_data') return h('div', { class: 'stack' }, sub('Если доход пропадёт'), h('p', { class: 'muted' }, 'Нужно хотя бы три полных месяца истории, чтобы это посчитать.'));
  if (r.status === 'no_deficit') return h('div', { class: 'stack' }, sub('Если доход пропадёт'), rows(row({ title: 'Ты не тратишь больше, чем получаешь', sub: 'денег хватает, пока так продолжается', chevron: false })));
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
      h('p', { class: 'muted' }, 'Какую часть расходов покрывает капитал и независимый доход. Для независимости нужно 125 %.'),
      h('div', { class: 'pos-cols' }, col(INDEPENDENCE_TEXTS.centralLabel, i.c.central, i.total.central), col(INDEPENDENCE_TEXTS.conservativeLabel, i.c.conservative, i.total.conservative)),
      i.p > 0 ? h('p', { class: 'muted' }, `Независимые поступления (пенсия, аренда и т. п.) покрывают ${pct(i.p)} расходов`) : null,
      i.status === 'not_confirmed' && i.requiredCapital > 0 ? h('p', { class: 'muted' }, `Для порога при центральных допущениях нужен капитал около ${money(i.requiredCapital)}`) : null,
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
    : d.hypotheticalLevel === 5 ? 'при таких расходах независимость подтверждалась бы (L5 «Свобода выбора»)' : 'при таких расходах независимость не подтверждалась бы';
  return h(
    'div',
    { class: 'stack' },
    sub(`При желаемых расходах (${DESIRED_LABEL})`, info('desiredScenario')),
    h('div', { class: 'card stack' },
      h('p', { class: 'muted' }, `А если бы ты тратил ${money(d.desired)} в месяц, а не ${money(d.current)}. Капитал и доходы те же. Это гипотеза: основной уровень от неё не меняется.`),
      h('div', { class: 'pos-cols' },
        col('Сейчас', v.independence.total.central, `при ${money(d.current)} в месяц`),
        col(`Гипотеза`, i.total.central, `при ${money(d.desired)} в месяц`)),
      h('p', { class: 'muted' }, `Покрытие капиталом и независимым доходом ${INDEPENDENCE_TEXTS.centralLabel}; при консервативных — ${pct(i.total.conservative)}. Для независимости нужно 125 %.`),
      i.requiredCapital > 0 ? h('p', { class: 'muted' }, `Капитал для порога: около ${money(d.requiredCapital.desired)} (сейчас для ${money(d.current)} в месяц — около ${money(d.requiredCapital.current)}).`) : h('p', { class: 'muted' }, 'Порог достигается уже за счёт независимых поступлений.'),
      h('p', { class: 'muted' }, `Запас денег при таких тратах — ${mo(d.reserveMonths)}`),
      h('p', null, level.replace(/^./, (c) => c.toUpperCase()) + '.'),
      h('small', { class: 'hint' }, INDEPENDENCE_TEXTS.scenarioNote)),
  );
}

function confidenceBlock(v: PositionView): HTMLElement {
  return rows(
    row({
      title: `Достоверность данных: ${pct(v.confidence)}`,
      sub: v.preliminary ? 'данных пока мало, поэтому уровень предварительный' : 'данных достаточно, чтобы уровню можно было верить',
      chevron: false,
      cls: v.preliminary ? 'warn' : '',
    }),
  );
}

export function renderPosition(): HTMLElement {
  const v = positionNow();
  const root = h('div', { class: 'screen' });
  if (v.status === 'no_data') {
    root.append(h('div', { class: 'card stack' }, h('strong', null, 'Положение пока не оценить'), h('p', { class: 'muted' }, 'Для оценки нужны операции из MoneyManager.'), h('a', { class: 'btn primary wide', href: '#/import' }, 'Загрузить бэкап')));
    return root;
  }
  root.append(levelCard(v));
  const w = warningsBlock(v);
  if (w) root.append(w);
  if (v.essentialMissing) root.append(rows(row({ title: 'Отметь, что обязательно', sub: 'ни одна трата не отмечена как «без этого не прожить» — запас считается неточно', href: '#/markup', cls: 'warn' })));
  root.append(directionsBlock(v));
  const wk = weakBlock(v);
  if (wk) root.append(wk);
  root.append(moneyBlock(v));
  const rw = runwayBlock(v);
  if (rw) root.append(rw);
  const sp = spiralBlock(v);
  if (sp) root.append(sp);
  const ind = independenceBlock(v);
  if (ind) root.append(ind);
  const ds = desiredBlock(v);
  if (ds) root.append(ds);
  root.append(confidenceBlock(v), h('div', { class: 'foot-note' }, explainLink('position')));
  return root;
}

/** Строка-карточка для «Обзора»: уровень и ссылка на полный экран. null — показывать нечего. */
export function positionRow(): HTMLElement | null {
  const v = positionNow();
  if (v.status === 'no_data' || v.level === null) return null;
  return rows(row({ title: `Положение: L${v.level} · ${v.levelName}`, sub: v.preliminary ? 'предварительно — данных пока мало' : v.weak ? `слабое место — ${v.weak.directionName}` : undefined, href: '#/position' }));
}

export { sheetHref };
