/** Минимальный хелпер для DOM без фреймворка (DECISIONS D3). */
export type Child = Node | string | number | null | undefined | false | Child[];
type Handler = (e: Event) => void;
export type Props = Record<string, string | number | boolean | Handler | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as Handler);
    else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
    else if (k === 'checked' && 'checked' in el) (el as HTMLInputElement).checked = Boolean(v);
    else if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Секция с заголовком. */
export function section(title: Child, ...children: Child[]): HTMLElement {
  return h('section', { class: 'card' }, h('h2', null, title), ...children);
}

export interface AskAction {
  label: string;
  kind?: 'primary' | 'danger' | 'plain';
}

/**
 * Окно снизу (D76): заголовок, пояснение, кнопки стопкой, «Отмена» последней.
 * Возвращает номер нажатой кнопки или null (отмена, Esc, нажатие мимо).
 */
export function ask(o: { title: string; text?: string; actions: AskAction[]; cancel?: string }): Promise<number | null> {
  return new Promise((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const done = (v: number | null) => {
      wrap.remove();
      document.removeEventListener('keydown', esc);
      prev?.focus?.();
      resolve(v);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done(null);
    };
    const acts = h(
      'div',
      { class: 'acts' },
      o.actions.map((a, i) => h('button', { class: `btn ${a.kind === 'danger' ? 'danger' : a.kind === 'plain' ? '' : 'primary'}`, type: 'button', onclick: () => done(i) }, a.label)),
      h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, o.cancel ?? 'Отмена'),
    );
    const box = h('div', { class: 'box', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title }, h('h2', null, o.title), o.text ? h('p', null, o.text) : null, acts);
    const wrap = h('div', { class: 'ask', onclick: (e: Event) => e.target === wrap && done(null) }, box);
    document.body.appendChild(wrap);
    document.addEventListener('keydown', esc);
    (acts.querySelector('button') as HTMLButtonElement | null)?.focus();
  });
}

/** Кнопка для необратимого действия: подтверждение окном снизу (D76). */
export function confirmButton(label: string, confirmLabel: string, action: () => void, cls = 'danger', text?: string): HTMLButtonElement {
  return h(
    'button',
    {
      class: `btn ${cls}`,
      type: 'button',
      onclick: async () => {
        const r = await ask({ title: confirmLabel, ...(text ? { text } : {}), actions: [{ label, kind: cls.includes('danger') ? 'danger' : 'primary' }] });
        if (r === 0) action();
      },
    },
    label,
  );
}

export function field(label: Child, input: HTMLElement, hint?: string): HTMLLabelElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('small', { class: 'hint' }, hint) : null);
}

export function table(headers: string[], rows: Child[][], cls = 'stackable'): HTMLTableElement {
  return h(
    'table',
    { class: `tbl ${cls}` },
    h('thead', null, h('tr', null, headers.map((x) => h('th', null, x)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { 'data-label': headers[i] ?? '' }, c))))),
  );
}

export function download(filename: string, content: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileBytes(file: File): Promise<Uint8Array> {
  return file.arrayBuffer().then((b) => new Uint8Array(b));
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastUndo = false;

export interface ToastOptions {
  /** «Отменить» в сообщении: 5 секунд с полоской-таймером (D76). */
  undo?: () => void | Promise<void>;
  level?: 'info' | 'error';
}

/** Сообщение внизу над панелью. С «Отменить» — 5 секунд и полоска; смахивается пальцем. */
export function toast(text: string, opts: ToastOptions | 'info' | 'error' = {}): void {
  const o: ToastOptions = typeof opts === 'string' ? { level: opts } : opts;
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(el);
    let x0: number | null = null;
    el.addEventListener('pointerdown', (e) => (x0 = e.clientX));
    el.addEventListener('pointerup', (e) => {
      if (x0 !== null && Math.abs(e.clientX - x0) > 60) hideToast(true);
      x0 = null;
    });
  }
  const ms = o.undo ? 5000 : 3500;
  toastUndo = !!o.undo;
  el.replaceChildren(
    ...([
    h('span', null, text),
    o.undo
      ? h(
          'button',
          {
            type: 'button',
            onclick: async () => {
              hideToast(true);
              await o.undo!();
            },
          },
          'Отменить',
        )
      : null,
    o.undo ? h('span', { class: 'tp', style: `animation-duration:${ms}ms` }) : null,
    ].filter(Boolean) as Node[]),
  );
  el.className = `on${o.level === 'error' ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hideToast(true), ms);
}

/** Спрятать сообщение. При переходе на другой экран гаснет только сообщение без «Отменить». */
export function hideToast(force = false): void {
  if (!force && toastUndo) return;
  const el = document.getElementById('toast');
  if (el) el.className = '';
  toastUndo = false;
}

/** Кнопка ⓘ с пояснением понятия. Открывается по нажатию (на телефоне нет наведения), закрывается повторным нажатием, Esc или нажатием вне. */
export function infoButton(title: string, text: string): HTMLElement {
  const pop = h('div', { class: 'info-pop', role: 'tooltip', hidden: true }, h('strong', null, title), h('p', null, text));
  const btn = h('button', { class: 'info', type: 'button', 'aria-label': `Пояснение: ${title}`, 'aria-expanded': 'false' });
  const wrap = h('span', { class: 'info-wrap' }, btn, pop);
  const close = () => {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', outside, true);
    document.removeEventListener('keydown', esc);
  };
  const outside = (e: Event) => {
    if (!wrap.contains(e.target as Node)) close();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pop.hidden) return close();
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    // не вылезать за край экрана
    pop.style.left = '0px';
    const r = pop.getBoundingClientRect();
    const over = r.right - (document.documentElement.clientWidth - 8);
    if (over > 0) pop.style.left = `${-over}px`;
    document.addEventListener('click', outside, true);
    document.addEventListener('keydown', esc);
  });
  return wrap;
}
