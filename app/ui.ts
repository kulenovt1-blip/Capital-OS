/** Общие элементы интерфейса поверх движка. */
import { ALL_CLASSES, BEHAVIOR_LABELS, CLASS_LABELS, formatDateRu, formatKZT, isAllowedClass, parseKZT, type Explanation, type Liquidity, type Money, type Notice, type OpClass, type ClassDef } from '../engine/index';
import { h, infoButton, type Child } from './dom';
import { HELP, type HelpKey } from './help-text';

export const fmt = (m: Money, sign = false): string => formatKZT(m, { sign });
export const fmtDate = formatDateRu;

export function moneySpan(m: Money, opts: { sign?: boolean; muted?: boolean } = {}): HTMLSpanElement {
  return h('span', { class: `money${m < 0 ? ' neg' : ''}${opts.muted ? ' muted' : ''}` }, fmt(m, opts.sign));
}

/** «Как посчитано»: каждое число на экране воспроизводимо из объяснения движка. */
export function explainBlock(e: Explanation, title = 'Как посчитано'): HTMLElement | null {
  if (!e.length) return null;
  // главное — сразу; второстепенное (нулевые суммы, перечни, исключения) — под «Все шаги» (D69)
  const main = e.filter((s) => !s.detail);
  const rest = e.filter((s) => s.detail);
  const li = (s: Explanation[number]) => h('li', { class: s.level ?? 'info' }, s.text);
  return h(
    'details',
    { class: 'explain' },
    h('summary', null, title),
    h('ul', null, (main.length ? main : e).map(li)),
    main.length && rest.length ? h('details', { class: 'explain-more', 'data-key': `${title}:all` }, h('summary', null, `Все шаги (${e.length})`), h('ul', null, e.map(li))) : null,
  );
}

/** Две строки прямо в разделе: что это и нужно ли это трогать (D70). */
export function guide(what: string, need: string): HTMLElement {
  return h('div', { class: 'guide' }, h('p', null, h('strong', null, 'Что это. '), what), h('p', null, h('strong', null, 'Нужно ли тебе. '), need));
}

/** Адрес экрана и раздела: #/settings/savings. */
export function href(route: string, section?: string): string {
  return `#/${route}${section ? `/${section}` : ''}`;
}

/** Предупреждения с кнопкой «куда идти исправлять». Если экран уже тот — только прокрутка к разделу. */
export function notices(list: Notice[]): HTMLElement | null {
  if (!list.length) return null;
  return h(
    'div',
    { class: 'notices' },
    list.map((n) =>
      h(
        'div',
        { class: `notice ${n.level} with-action` },
        h('span', null, n.text),
        n.action ? h('a', { class: 'btn small', href: href(n.action.route, n.action.section) }, n.action.label) : null,
      ),
    ),
  );
}

/** Дать блоку якорь для перехода #/экран/раздел. */
export function anchor<T extends HTMLElement>(el: T, id: string): T {
  el.id = `sec-${id}`;
  return el;
}

export function stat(label: Child, value: Child, sub?: Child, cls = ''): HTMLElement {
  return h('div', { class: `stat ${cls}` }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), sub ? h('div', { class: 'stat-sub' }, sub) : null);
}

export function liquidityText(l: Liquidity): string {
  if (l.kind === 'instant') return 'сразу';
  if (l.kind === 'days') return `за ${l.days} дн.`;
  return `до ${fmtDate(l.date)}`;
}

/** Выбор класса: встроенные, допустимые для вида операции, и свои — сгруппированы. */
export function classSelect(kind: 'income' | 'expense', value: OpClass | '', onChange: (c: OpClass) => void, registry: readonly ClassDef[] = []): HTMLSelectElement {
  const allowed = (c: OpClass) => c !== 'UNCLASSIFIED' && isAllowedClass(kind, c);
  const opt = (c: OpClass, label: string) => h('option', { value: c, selected: c === value }, label);
  const builtin = ALL_CLASSES.filter(allowed);
  const own = registry.filter((c) => !c.builtin && allowed(c.id));
  const group = (title: string, items: HTMLOptionElement[]) => (items.length ? h('optgroup', { label: title }, items) : null);
  const s = h(
    'select',
    { onchange: () => onChange(s.value as OpClass) },
    h('option', { value: '', disabled: true, selected: value === '' }, '— выбрать класс —'),
    group('Свои классы', own.map((c) => opt(c.id, `${c.label} · ${BEHAVIOR_LABELS[c.behavior]}`))),
    group(kind === 'income' ? 'Доходы' : 'Расходы', builtin.filter((c) => c.startsWith(kind === 'income' ? 'I_' : 'E_')).map((c) => opt(c, `${CLASS_LABELS[c]} (${c})`))),
    group('Долги', builtin.filter((c) => c.startsWith('F_')).map((c) => opt(c, `${CLASS_LABELS[c]} (${c})`))),
    group('Технические', builtin.filter((c) => c.startsWith('T_')).map((c) => opt(c, `${CLASS_LABELS[c]} (${c})`))),
  );
  return s;
}

export function moneyInput(name: string, value?: Money, placeholder = '0'): HTMLInputElement {
  return h('input', { name, inputmode: 'decimal', placeholder, value: value === undefined ? '' : formatKZT(value, { bare: true }), autocomplete: 'off' });
}

export function readMoney(form: HTMLFormElement, name: string): Money | null {
  const v = (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '';
  return parseKZT(v);
}

export function readStr(form: HTMLFormElement, name: string): string {
  const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  return (el?.value ?? '').trim();
}

export function readChecked(form: HTMLFormElement, name: string): boolean {
  return (form.elements.namedItem(name) as HTMLInputElement | null)?.checked ?? false;
}

export function errorsBox(errs: string[]): HTMLElement | null {
  return errs.length ? h('div', { class: 'notice error' }, h('ul', null, errs.map((e) => h('li', null, e)))) : null;
}

let seq = 0;
/** Идентификатор для сущностей, созданных в UI. Время здесь допустимо — это не расчёт. */
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
}

/** ⓘ по ключу глоссария. */
export function info(key: HelpKey): HTMLElement {
  const e = HELP[key];
  return infoButton(e.title, e.text);
}
