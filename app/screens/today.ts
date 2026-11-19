/**
 * «Сегодня» — главный экран простого режима (дизайн A+, D7): три блока — сколько можно потратить, один следующий шаг,
 * ближайший платёж — и ссылка «Включить полный режим». Если есть вопросы и предупреждения — одна свёрнутая строка «Нужно решение». Ничего не считает заново: числа те же, что на «Обзоре» полного режима.
 * Предупреждения о старых данных и о малой истории остаются: без них число читалось бы точнее, чем оно есть.
 */
import { arrivedIncomes } from '../../engine/index';
import { h } from '../dom';
import { act, getState, today } from '../store';
import { ov, positionNow, progress } from '../ctx';
import { attentionItems } from '../attention';
import { fmtShort, hero, info } from '../ui';
import { sheetHref, trustNeedsAttention } from '../main';
import { iconBox } from '../tiles';
import { autoTour, spendTour } from '../tours';
import { cushionPinGap, decisionRow, freshnessNote, heroBlock, historyNote, roadStepNow } from './overview';
import { dayMonth, paymentCover, todayLine, todayStep } from '../today';

const tagged = (el: HTMLElement, t: string): HTMLElement => (el.setAttribute('data-tour', t), el);

/**
 * Значок ступени в шапке вместо значка доверия (макет D7). Если у значка доверия есть что сказать — жёлтый или красный —
 * он остаётся на месте: предупреждение о цифрах важнее ступени.
 */
export function stepChip(): HTMLElement | null {
  if (trustNeedsAttention()) return null;
  const v = positionNow();
  if (v.status !== 'ok' || v.level === null) return null;
  const lvl = v.level;
  return h(
    'a',
    { class: 'step-chip', href: '#/position', 'data-tour': 'step-chip', 'aria-label': `Ступень ${lvl} из 5. Открыть дорогу` },
    h('span', { class: 'sc-bars', 'aria-hidden': 'true' }, [1, 2, 3, 4, 5].map((n) => h('span', { class: n <= lvl ? 'on' : '', style: `height:${4 + n * 3}px` }))),
    `Ступень ${lvl}`,
  );
}

export function renderToday(): HTMLElement {
  const st = getState();
  const o = ov();
  const sp = o.spend;
  // первый раз с данными — подсказка «сколько можно тратить» поверх экрана (D193)
  autoTour('overview', '#/overview', spendTour);

  const line = todayLine(sp.canSpend, { date: o.nextIncome.date, scheduled: o.nextIncome.source === 'schedule' });
  // при нехватке — прежний блок «Не хватает…» с выходом (D182): бодрая фраза над минусом была бы неправдой
  const main =
    line === null
      ? tagged(heroBlock(o), 'hero')
      : tagged(hero(h('span', null, 'Сегодня можно потратить сверх обычного', info('free')), fmtShort(sp.perDay), line, { extra: h('a', { class: 'link', href: sheetHref('explain', 'overview') }, 'Как посчитано ›') }), 'hero');

  const arrived = arrivedIncomes(st, today(), o);
  const pin = cushionPinGap(o);
  const step = todayStep({
    firstRunDone: !!st.settings.firstRunDone,
    arrived: arrived[0] ? { amount: `+${fmtShort(arrived[0].amount)}`, title: arrived[0].title, more: arrived.length - 1 } : null,
    cushionPin: pin === null ? null : fmtShort(pin),
    road: roadStepNow(),
  });

  const p = progress();
  const decisions = decisionRow(attentionItems(), p.done < p.total ? p : undefined);
  const pay = o.upcoming30[0];
  const cover = pay ? paymentCover(pay.date, o.nextIncome.date, sp.canSpend) : null;

  return h(
    'div',
    { class: 'screen today' },
    freshnessNote(),
    historyNote(o),
    main,
    step ? h('section', { class: 'today-step', 'data-tour': 'step', 'aria-label': 'Следующий шаг' }, h('div', { class: 'ts-k' }, 'Следующий шаг'), h('div', { class: 'ts-t' }, step.title), h('a', { class: 'btn primary big wide', href: step.href }, step.button)) : null,
    pay
      ? h(
          'a',
          { class: 'act-card', href: sheetHref('payments'), 'data-tour': 'payment' },
          iconBox('calendar'),
          h(
            'div',
            { class: 'ac-main' },
            h('div', { class: 'ct-sub' }, `Ближайший платёж · ${dayMonth(pay.date)}`),
            h('strong', null, `${pay.title}${pay.owner === 'family' ? ' (семья)' : ''} ${fmtShort(pay.amount)}`),
            cover ? h('div', { class: `today-cover ${cover === 'covered' ? 'ok' : 'short'}` }, cover === 'covered' ? 'деньги для него уже есть' : 'до дохода денег не хватает') : null,
          ),
          h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
        )
      : null,
    // вопросы и предупреждения не прячем: одна свёрнутая строка, только когда есть что показать
    decisions,
    h(
      'button',
      { class: 'today-full', type: 'button', 'data-tour': 'full', onclick: () => void act((s) => ({ ...s, settings: { ...s.settings, uiMode: 'full' } }), 'Полный режим включён') },
      'Нужно больше? Включить полный режим ›',
    ),
  );
}
