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

/**
 * Карточка для «Обзора» (D193): одна плитка — сколько осталось за месяц крупно и две полоски «пришло / ушло».
 * Таблица и совет — на экране «Итоги месяцев» по «Подробнее». null — показывать нечего (не первые дни месяца, закрыта, данных мало).
 */
export function monthlyCard(): HTMLElement | null {
  const st = getState();
  const m = monthlyCardMonth(st, today());
  if (!m) return null;
  const s = monthlySummary(st, today(), m);
  if (!s || s.partial) return null;
  const close = () => void act((x) => ({ ...x, settings: { ...x.settings, summarySeen: [...new Set([...(x.settings.summarySeen ?? []), m])] } }), 'Итоги закрыты — они остались в «Ещё → Итоги месяцев»');
  const top = Math.max(s.income as number, s.spent as number, 1);
  const bar = (v: Money, cls: string) => h('span', { class: `mbar ${cls}`, style: `width:${Math.max(4, Math.round(((v as number) / top) * 100))}%` });
  const share = s.leftShare !== null && s.income > 0 ? `осталось ${Math.round(s.leftShare * 100)} % дохода` : null;
  const cap = s.capitalDelta !== null ? `капитал ${signed(s.capitalDelta)}` : null;
  return h(
    'section',
    { class: 'mcard', 'aria-label': `Итоги ${monthTitleGen(m)}`, 'data-tour': 'month' },
    h('div', { class: 'mhead' }, h('span', null, `Итоги ${monthTitleGen(m).toLowerCase()}`), h('a', { href: '#/months' }, 'Подробнее ›'), h('button', { class: 'mclose', type: 'button', 'aria-label': 'Закрыть итоги', onclick: close }, '×')),
    h('div', { class: `mval${s.left < 0 ? ' neg' : ''}` }, signed(s.left)),
    h('div', { class: 'msub' }, [share, cap].filter(Boolean).join(' · ')),
    h('div', { class: 'mbars' }, h('span', null, 'Пришло'), h('span', { class: 'mtrack' }, bar(s.income, 'in')), h('b', null, fmt(s.income)), h('span', null, 'Ушло'), h('span', { class: 'mtrack' }, bar(s.spent, 'out')), h('b', null, fmt(s.spent))),
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
