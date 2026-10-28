/**
 * «Требует внимания» (D82): шаги настройки и предупреждения движка — одной короткой строкой со ссылкой.
 * Строка про сверку — первая и красная. Повторы (шаг и его предупреждение) схлопываются в одну строку.
 */
import type { Notice } from '../engine/index';
import { ov, steps } from './ctx';
import { fmt, fmtExact, nWord } from './ui';
import type { AttentionItem } from './ui';

/** Коды предупреждений, которые уже показаны строкой шага настройки. */
const COVERED: Record<string, string> = {
  unclassified: 'classes',
  'accounts.review': 'accounts',
  'capital.savings_flow': 'savings',
  'installments.detected': 'obligations',
  'capital.payables_negative': 'debts',
  'capital.receivables_negative': 'debts',
};

function short(n: Notice): AttentionItem | null {
  const title = (s: string) => s.match(/^«[^»]+»/)?.[0] ?? '';
  switch (true) {
    case n.code === 'reconcile.fail':
    case n.code === 'import.missing':
    case n.code === 'free.negative':
      return null; // сверка — отдельной строкой ниже; нет данных — пустой экран; минус — в главном числе
    case n.code === 'import.warnings':
      return { title: n.text.replace(/ — см\. экран «Импорт»$/, ''), href: '#/import' };
    case n.code === 'goals.over_assigned':
      return { title: `${title(n.text)}: за целями больше, чем на счёте`, href: '#/goals', bad: true };
    case n.code === 'goal.achieved':
      return { title: `${n.text.match(/«[^»]+»/)?.[0] ?? 'Цель'} достигла минимума`, href: '#/goals' };
    case n.code === 'installments.amount':
      return { title: `${title(n.text)}: платёж изменился`, href: '#/debts' };
    case n.code === 'installments.stalled':
      return { title: `${title(n.text)}: платежи не найдены`, href: '#/debts' };
    case n.code === 'obligation.overdue':
      return { title: `${title(n.text)}: платёж не найден в операциях`, href: '#/debts' };
    case n.code === 'obligation.overpaid':
      return { title: `${title(n.text)}: оплачено больше остатка`, href: '#/debts' };
    case n.code === 'capital.double_debt':
      return { title: 'Долг мог посчитаться дважды', href: '#/rare' };
    case n.code === 'accounts.bound_invalid':
      return { title: 'Привязка счёта к цели не действует', href: '#/accounts' };
    case n.code === 'capital.savings_receiver_missing':
      return { title: 'Счёт для сбережений не найден', href: '#/accounts/savings' };
    default:
      return n.level === 'info' ? null : { title: n.text.length > 70 ? `${n.text.slice(0, 68)}…` : n.text, href: n.action ? `#/${n.action.route}${n.action.section ? `/${n.action.section}` : ''}` : '#/setup' };
  }
}

export function attentionItems(): AttentionItem[] {
  const o = ov();
  const out: AttentionItem[] = [];
  if (!o.hasData) return [{ title: 'Загрузить бэкап MoneyManager', href: '#/import' }];
  for (const a of (o.reconcile?.accounts ?? []).filter((x) => x.status !== 'ok')) {
    out.push({ title: `Сверка: «${a.title}» ${a.status === 'no_reference' ? 'без эталона' : fmtExact(a.diff, true)} — цифрам нельзя верить`, href: '#/import', bad: true });
  }
  const st = steps();
  for (const s of st) {
    if (s.done || s.optional || s.locked || s.id === 'import') continue;
    const href = `#/setup/${s.id}`;
    if (s.id === 'accounts') {
      const names = s.status.match(/«[^»]+»/g) ?? [];
      out.push({ title: names.length === 1 ? `${names[0]} — что это за счёт?` : `${nWord(names.length, 'счёт', 'счёта', 'счетов')} «не учитывать» — что это?`, href });
    } else if (s.id === 'classes') {
      const n = o.classification?.unclassified.length ?? 0;
      out.push({ title: `Разметить ${nWord(n, 'категорию', 'категории', 'категорий')}`, href });
    } else if (s.id === 'income') out.push({ title: 'Добавить доход: когда и сколько приходит', href });
    else if (s.id === 'savings') {
      const est = o.capital.accounts.find((p) => p.source === 'savings_flow');
      out.push({ title: `Сбережения вне MoneyManager: проверь ${est ? fmt(est.balance) : 'оценку'}`, href });
    } else if (s.id === 'debts') out.push({ title: 'Долги до начала данных: указать или «не знаю»', href });
    else if (s.id === 'obligations') {
      const n = o.installments.suggestions.length;
      out.push({ title: `${nWord(n, 'рассрочка', 'рассрочки', 'рассрочек')} не заведены`, href });
    } else if (s.id === 'goals') out.push({ title: o.goals.some((g) => g.status === 'active') ? 'Задать сумму целям' : 'Создать первую цель', href });
    else out.push({ title: s.title, href });
  }
  const covered = new Set<string>(st.filter((s) => !s.done && !s.optional && !s.locked).map((s) => s.id));
  for (const n of o.notices) {
    const by = COVERED[n.code];
    if (by && covered.has(by)) continue;
    const it = short(n);
    if (it && !out.some((x) => x.title === it.title)) out.push(it);
  }
  return out;
}
