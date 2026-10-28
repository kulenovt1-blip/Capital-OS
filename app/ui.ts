/** Общие элементы интерфейса поверх движка. */
import { ALL_CLASSES, BEHAVIOR_LABELS, CLASS_LABELS, formatDateRu, formatKZT, isAllowedClass, parseKZT, type Explanation, type Liquidity, type Money, type Notice, type OpClass, type ClassDef } from '../engine/index';
import { h, infoButton, type Child } from './dom';
import { HELP, type HelpKey } from './help-text';

/** Сумма на экране — целые тенге (D77). Тиыны — только в сверке импорта и в «Как посчитано»: fmtExact. */
export const roundTenge = (m: Money): Money => (Math.round(m / 100) * 100) as Money;
export const fmt = (m: Money, sign = false): string => formatKZT(roundTenge(m), { sign });
export const fmtExact = (m: Money, sign = false): string => formatKZT(m, { sign });
export const fmtDate = formatDateRu;
/** «12.10» — короткая дата для подписей. */
export const fmtDay = (d: string): string => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const NB = '\u00a0';
/** «2,69 млн ₸», «613 тыс ₸» — для прогноза. */
export function fmtShort(m: Money): string {
  const t = m / 100;
  const a = Math.abs(t);
  const sign = t < 0 ? '−' : '';
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: a >= 10_000_000 ? 1 : 2 })}${NB}млн${NB}₸`;
  if (a >= 10_000) return `${sign}${Math.round(a / 1000)}${NB}тыс${NB}₸`;
  return fmt(m);
}
/** «63 %», «5,2 %». */
export function pct(x: number, digits = 1): string {
  return `${x.toLocaleString('ru-RU', { maximumFractionDigits: digits })}${NB}%`;
}
/** Склонение: plural(1, 'счёт', 'счёта', 'счетов'). */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
export const nWord = (n: number, one: string, few: string, many: string): string => `${n}${NB}${plural(n, one, few, many)}`;

export function moneySpan(m: Money, opts: { sign?: boolean; muted?: boolean; exact?: boolean } = {}): HTMLSpanElement {
  return h('span', { class: `money${m < 0 ? ' neg' : ''}${opts.muted ? ' muted' : ''}` }, opts.exact ? fmtExact(m, opts.sign) : fmt(m, opts.sign));
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
    h('option', { value: '', disabled: true, selected: value === '' }, '— выбрать тип —'),
    group('Свои типы', own.map((c) => opt(c.id, `${c.label} · ${BEHAVIOR_LABELS[c.behavior]}`))),
    group(kind === 'income' ? 'Доходы' : 'Траты', builtin.filter((c) => c.startsWith(kind === 'income' ? 'I_' : 'E_')).map((c) => opt(c, typeLabel(c)))),
    group('Долги', builtin.filter((c) => c.startsWith('F_')).map((c) => opt(c, typeLabel(c)))),
    group('Переводы', builtin.filter((c) => c.startsWith('T_')).map((c) => opt(c, typeLabel(c)))),
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
  return errs.length ? h('div', { class: 'error-box', role: 'alert' }, errs.length === 1 ? errs[0] : h('ul', null, errs.map((e) => h('li', null, e)))) : null;
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


/** Название типа без кода и без префикса «Расход:» / «Доход:» — на экране (D78). */
export function typeLabel(c: OpClass, reg: readonly ClassDef[] = []): string {
  const own = reg.find((x) => x.id === c);
  if (own && !own.builtin) return own.label;
  const l = (CLASS_LABELS as Record<string, string>)[c] ?? 'Свой тип';
  return l.replace(/^(Расход|Доход):\s*/, '').replace(/^./, (x) => x.toUpperCase());
}

// ───────────────────────── компоненты (D76) ─────────────────────────

/** Тёмная плашка с одним большим числом. */
export function hero(label: Child, value: Child, sub?: Child, opts: { neg?: boolean; extra?: Child } = {}): HTMLElement {
  return h('section', { class: 'hero', 'aria-label': typeof label === 'string' ? label : undefined }, h('div', { class: 'label' }, label), h('div', { class: `value${opts.neg ? ' neg' : ''}` }, value), sub ? h('div', { class: 'subline' }, sub) : null, opts.extra ?? null);
}

/** Строка списка: слева название и подпись, справа сумма, в конце ›. */
export function row(o: { title: Child; sub?: Child; value?: Child; href?: string; onClick?: () => void; chevron?: boolean; cls?: string; lead?: Child; mark?: boolean }): HTMLElement {
  const inner = [
    o.lead ?? null,
    o.mark ? h('span', { class: 'mark', title: 'сверка не сошлась' }) : null,
    h('div', { class: 'main' }, h('div', { class: 'title' }, o.title), o.sub ? h('div', { class: 'rsub' }, o.sub) : null),
    o.value !== undefined && o.value !== null ? h('div', { class: 'val' }, o.value) : null,
    o.chevron ?? (o.href || o.onClick) ? h('span', { class: 'chev', 'aria-hidden': 'true' }, '›') : null,
  ];
  const cls = `row${o.cls ? ` ${o.cls}` : ''}`;
  if (o.href) return h('a', { class: cls, href: o.href }, inner);
  if (o.onClick) return h('button', { class: cls, type: 'button', onclick: o.onClick }, inner);
  return h('div', { class: cls }, inner);
}

export function rows(...items: Child[]): HTMLElement {
  return h('div', { class: 'rows' }, items);
}

/** Подпись раздела прописными. */
export function sub(text: Child, right?: Child): HTMLElement {
  return h('h3', { class: 'sub' }, h('span', null, text), right ?? null);
}

/** Сегментный переключатель; активный — почти чёрный. */
export function seg<T extends string>(options: readonly (readonly [T, string])[], value: T, onChange: (v: T) => void, label?: string): HTMLElement {
  return h(
    'div',
    { class: 'seg', role: 'radiogroup', 'aria-label': label },
    options.map(([v, l]) => h('button', { type: 'button', class: v === value ? 'on' : '', role: 'radio', 'aria-checked': v === value ? 'true' : 'false', onclick: () => onChange(v) }, l)),
  );
}

/** Чип: фильтр или подсказка, 44 px. */
export function chip(label: Child, on = false, onClick?: () => void, cls = ''): HTMLElement {
  return onClick
    ? h('button', { type: 'button', class: `chip${on ? ' on' : ''}${cls ? ` ${cls}` : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: onClick }, label)
    : h('span', { class: `chip static${cls ? ` ${cls}` : ''}` }, label);
}

/** Полоса главного действия внизу экрана, над навигацией. */
export function stickyBar(summary: Child, action: Child): HTMLElement {
  return h('div', { class: 'sticky-bar' }, h('div', { class: 'in' }, h('div', { class: 'sum' }, summary), action));
}

export interface AttentionItem {
  title: string;
  href: string;
  bad?: boolean;
}

/** Одна карточка «Требует внимания · N»: строки в одну строку со стрелкой; видно 3, остальное под «ещё N». */
export function attention(items: AttentionItem[], progress?: { done: number; total: number }): HTMLElement | null {
  if (!items.length && !progress) return null;
  const sorted = [...items.filter((x) => x.bad), ...items.filter((x) => !x.bad)];
  const shown = sorted.slice(0, 3);
  const rest = sorted.slice(3);
  const restBox = h('div', { hidden: true }, rest.map((i) => row({ title: i.title, href: i.href, cls: i.bad ? 'bad' : '', lead: h('span', { class: 'lead' }) })));
  return h(
    'section',
    { class: 'attention', 'aria-label': 'Требует внимания' },
    h(
      'div',
      { class: 'head' },
      h('div', { class: 't' }, h('span', null, `Требует внимания · ${items.length}`), progress ? h('span', { class: 'muted' }, `настройка ${progress.done} из ${progress.total}`) : null),
      progress ? h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(progress.done), 'aria-valuemax': String(progress.total), 'aria-label': 'Настройка' }, h('span', { style: `width:${progress.total ? Math.round((progress.done * 100) / progress.total) : 0}%` })) : null,
    ),
    shown.map((i) => row({ title: i.title, href: i.href, cls: i.bad ? 'bad' : '', lead: h('span', { class: 'lead' }) })),
    restBox,
    rest.length
      ? h(
          'button',
          {
            class: 'more',
            type: 'button',
            onclick: (e: Event) => {
              restBox.hidden = false;
              (e.currentTarget as HTMLElement).remove();
            },
          },
          `ещё ${rest.length}`,
        )
      : null,
  );
}
