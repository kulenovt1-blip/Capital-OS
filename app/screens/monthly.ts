/** «Итоги месяца» (D184): карточка на «Обзоре» в первые дни месяца и история в «Ещё». */
import { h } from '../dom';
import { act, getState, today } from '../store';
import { fmt, row, rows } from '../ui';
import { currentStepName, monthTitle, monthTitleGen, monthlyCardMonth, monthlySummaries, monthlySummary, type Money, type MonthlySummary } from '../../engine/index';

const signed = (m: Money): string => `${m > 0 ? '+' : m < 0 ? '−' : ''}${fmt(Math.abs(m) as Money)}`;

/** Строки итогов одного месяца: знак стоит у суммы. */
function lines(s: MonthlySummary, step?: { level: number; name: string } | null): HTMLElement[] {
  return [
    row({ title: 'Пришло', value: fmt(s.income), chevron: false }),
    row({ title: 'Ушло', value: fmt(s.spent), chevron: false }),
    row({ title: 'Осталось', sub: s.leftShare !== null && s.income > 0 ? `${Math.round(s.leftShare * 100)} % дохода` : undefined, value: signed(s.left), chevron: false }),
    s.capitalDelta !== null ? row({ title: 'Капитал за месяц', sub: `на конец месяца ${fmt(s.capitalTo)}`, value: signed(s.capitalDelta), chevron: false }) : row({ title: 'Капитал на конец месяца', value: fmt(s.capitalTo), chevron: false }),
    s.toGoals > 0 ? row({ title: 'Отложено на цели', value: fmt(s.toGoals), chevron: false }) : null,
    step ? row({ title: 'Ступень сейчас', value: `${step.level} · ${step.name}`, chevron: false }) : null,
  ].filter((x): x is HTMLElement => x !== null);
}

/** Карточка для «Обзора»: null — показывать нечего (не первые дни месяца, закрыта, данных мало). */
export function monthlyCard(): HTMLElement | null {
  const st = getState();
  const m = monthlyCardMonth(st, today());
  if (!m) return null;
  const s = monthlySummary(st, today(), m);
  if (!s || s.partial) return null;
  const close = () => void act((x) => ({ ...x, settings: { ...x.settings, summarySeen: [...new Set([...(x.settings.summarySeen ?? []), m])] } }), 'Итоги закрыты — они остались в «Ещё → Итоги месяцев»');
  return h(
    'section',
    { class: 'card stack', 'aria-label': `Итоги ${monthTitleGen(m)}` },
    h('strong', null, `Итоги: ${monthTitle(m).toLowerCase()}`),
    rows(...lines(s, currentStepName(st, today()))),
    h('p', null, s.advice),
    h('div', { class: 'chips wrap' }, h('a', { class: 'chip', href: '#/months' }, 'Все месяцы'), h('button', { class: 'chip', type: 'button', onclick: close }, 'Закрыть')),
  );
}

/** Экран «Итоги месяцев»: последние месяцы, свежий раскрыт. */
export function renderMonths(): HTMLElement {
  const st = getState();
  const root = h('div', { class: 'screen' });
  const list = monthlySummaries(st, today(), 12);
  if (!list.length) {
    root.append(h('p', { class: 'muted' }, 'Итогов пока нет: нужен хотя бы один законченный месяц с операциями. Загрузи бэкап MoneyManager.'));
    return root;
  }
  const step = currentStepName(st, today());
  list.forEach((s, i) => {
    root.append(
      h(
        'details',
        { class: 'fold', ...(i === 0 ? { open: true } : {}), 'data-key': `months:${s.month}` },
        h('summary', null, `${monthTitle(s.month)} · ${signed(s.left)}`),
        h('div', { class: 'stack' }, rows(...lines(s, i === 0 ? step : null)), h('p', null, s.advice)),
      ),
    );
  });
  root.append(h('p', { class: 'one-line' }, 'Пришло и ушло — по операциям MoneyManager. Капитал — как на «Обзоре», на конец месяца. «Сверх обычного» — категории, где ушло заметно больше, чем в среднем за прошлые месяцы.'));
  return root;
}
