/**
 * Каркас PWA (D76): маршруты по hash, нижняя панель из 5 пунктов, шапка с датой и доверием к цифрам,
 * подэкраны (sheet) поверх экрана — тоже в адресе, поэтому работает кнопка «назад» телефона.
 *
 * Адрес: #/<экран>[/<раздел>][~<подэкран>[/<аргумент>]]. Старые адреса (#/settings/income, #/classes…) ведут на новые места.
 */
import { initInstall } from './install';
import './styles.css';
import { h, clear, hideToast, type Child } from './dom';
import { loadState, subscribe, today } from './store';
import { trust } from './ctx';
import { initTheme } from './theme';

export type NavId = 'overview' | 'goals' | 'income' | 'forecast' | 'more';

export interface Route {
  path: string;
  title: string;
  /** Какой пункт нижней панели подсвечен. */
  nav: NavId;
  /** Подэкран «Ещё»: в шапке «‹ Назад» к родителю. */
  parent?: string;
  /** Весь экран без нижней панели (мастер). */
  lock?: boolean;
  render: (rerender: () => void, section?: string) => HTMLElement;
}

export interface SheetView {
  title: string;
  body: Child;
  /** Полоса главного действия внизу подэкрана. */
  bar?: HTMLElement;
}

export const routes: Route[] = [];
const sheets = new Map<string, (arg: string) => SheetView | null>();

export function addRoute(r: Route): void {
  routes.push(r);
}

/** Подэкран по имени: строится заново при каждом изменении состояния. */
export function defineSheet(name: string, build: (arg: string) => SheetView | null): void {
  sheets.set(name, build);
}

/** Старые адреса → новые (D81). */
const REDIRECTS: Record<string, string> = {
  classes: 'markup',
  'classes/categories': 'markup',
  settings: 'more',
  'settings/money': 'more',
  'settings/accounts': 'accounts',
  'settings/income': 'incomes',
  'settings/obligations': 'debts',
  'settings/savings': 'accounts/savings',
  'settings/debts': 'rare/debts',
  'settings/manual': 'rare/manual',
  'settings/adjustments': 'rare/adjustments',
  'settings/backup': 'backup',
  'settings/install': 'install',
  'settings/calc': 'advanced',
  'settings/classification': 'advanced/rules',
  'settings/params': 'advanced/params',
  'settings/strategy': 'advanced/strategy',
  'settings/scenarios': 'advanced/scenarios',
  'import/review': 'setup/accounts',
};

interface Parsed {
  path: string;
  section?: string;
  sheet?: string;
  arg: string;
}

function parseHash(): Parsed {
  const raw = location.hash.replace(/^#\/?/, '');
  const [page = '', sheetPart] = raw.split('~');
  const [path = '', ...rest] = page.split('/');
  const section = rest.join('/') || undefined;
  const [sheet, ...args] = (sheetPart ?? '').split('/');
  return { path, ...(section ? { section } : {}), ...(sheet ? { sheet } : {}), arg: args.join('/') };
}

/** Адрес текущего экрана без подэкрана. */
export function baseHash(): string {
  return '#/' + location.hash.replace(/^#\/?/, '').split('~')[0];
}

let sheetOpenedInApp = false;
export function sheetHref(name: string, arg = ''): string {
  return `${baseHash()}~${name}${arg ? `/${arg}` : ''}`;
}
export function openSheet(name: string, arg = ''): void {
  sheetOpenedInApp = true;
  location.hash = sheetHref(name, arg);
}
export function closeSheet(): void {
  if (sheetOpenedInApp) {
    sheetOpenedInApp = false;
    history.back();
  } else location.replace(baseHash());
}
/** Перейти на экран, закрыв подэкран. */
export function go(hash: string): void {
  sheetOpenedInApp = false;
  location.hash = hash;
}

const app = document.getElementById('app')!;

function current(p: Parsed): Route {
  return routes.find((r) => r.path === p.path) ?? routes[0]!;
}

const ICONS: Record<NavId, string> = {
  overview: 'M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z',
  goals: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 11a1 1 0 1 0 1 1M14 10l6-6M17 4h3v3',
  income: 'M12 4v10m0 0-4-4m4 4 4-4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  forecast: 'M4 19h16M5 15l4-5 4 3 6-8',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};
const NAV: [NavId, string][] = [
  ['overview', 'Обзор'],
  ['goals', 'Цели'],
  ['income', 'Доход'],
  ['forecast', 'Прогноз'],
  ['more', 'Ещё'],
];

function icon(id: NavId): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', ICONS[id]);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', id === 'more' ? '3.2' : '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(p);
  return svg;
}

function nav(active: NavId): HTMLElement {
  return h(
    'nav',
    { class: 'bn', 'aria-label': 'Разделы' },
    h('div', { class: 'brand' }, 'Capital OS'),
    NAV.map(([id, label]) => h('a', { href: `#/${id}`, class: id === active ? 'on' : '', 'aria-current': id === active ? 'page' : undefined }, h('span', { class: 'ic' }, icon(id)), h('span', null, label))),
  );
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function dateLine(): string {
  const [y, m, d] = today().split('-').map(Number);
  const wd = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${d} ${MONTHS[m! - 1]}`;
}

/** Значок доверия к цифрам: серый / жёлтый / красный; нажатие — причины со ссылками (D80). */
export function trustChip(): HTMLElement {
  const t = trust();
  return h(
    'a',
    { class: `trust ${t.level === 'bad' ? 'bad' : t.level === 'warn' ? 'warn' : ''}`, href: sheetHref('trust'), 'aria-label': `Доверие к цифрам: ${t.label}` },
    h('span', { class: 'td' }),
    h('span', null, t.label),
  );
}

defineSheet('trust', () => {
  const t = trust();
  return {
    title: 'Насколько верить цифрам',
    body: t.reasons.length
      ? h(
          'div',
          { class: 'rows' },
          t.reasons.map((r) => h('a', { class: `row${r.bad ? ' bad' : ''}`, href: r.href, onclick: (e: Event) => (e.preventDefault(), go(r.href)) }, h('div', { class: 'main' }, h('div', { class: 'title' }, r.text)), h('span', { class: 'chev' }, '›'))),
        )
      : h('div', { class: 'okline' }, '✓ Сверка сошлась, настройка пройдена — цифры считаются по всем данным.'),
  };
});

function header(r: Route): HTMLElement {
  const parent = r.parent ? routes.find((x) => x.path === r.parent) : undefined;
  return h(
    'header',
    { class: 'top' },
    parent ? h('a', { class: 'back', href: `#/${parent.path}` }, '‹ ', parent.title) : h('div', { class: 'date' }, dateLine()),
    h('div', { class: 'ttl-row' }, h('h1', { tabindex: '-1', id: 'screen-title' }, r.title), trustChip()),
  );
}

function sheetView(p: Parsed): HTMLElement | null {
  if (!p.sheet) return null;
  const build = sheets.get(p.sheet);
  const v = build?.(p.arg);
  if (!v) return null;
  const el = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': v.title },
    h('div', { class: 'sh-head' }, h('button', { class: 'back', type: 'button', onclick: closeSheet }, '‹ Назад'), h('h2', null, v.title)),
    h('div', { class: 'sh-body' }, v.body),
    v.bar ?? null,
  );
  return el;
}

let lastKey = '';
function render(): void {
  const p = parseHash();
  // старые адреса
  const full = p.section ? `${p.path}/${p.section}` : p.path;
  const to = REDIRECTS[full] ?? REDIRECTS[p.path];
  if (to) {
    location.replace(`#/${to}${p.sheet ? `~${p.sheet}${p.arg ? `/${p.arg}` : ''}` : ''}`);
    return;
  }
  const r = current(p);
  const key = (d: Element) => (d as HTMLElement).dataset.key ?? d.querySelector(':scope > summary')?.textContent ?? '';
  const openDetails = new Set([...app.querySelectorAll('details[open]')].map(key));
  const prevSheet = app.querySelector('.sheet');
  const sheetScroll = prevSheet?.scrollTop ?? 0;
  const scrollY = window.scrollY;
  clear(app);
  const sh = sheetView(p);
  app.append(
    ...([
    h('a', { class: 'skip', href: '#screen-title', onclick: (e: Event) => (e.preventDefault(), document.getElementById('screen-title')?.focus()) }, 'К содержимому'),
    r.lock ? null : nav(r.nav),
    header(r),
    h('main', { id: 'main' }, r.render(render, p.section)),
    sh,
    ].filter(Boolean) as Node[]),
  );
  document.body.classList.toggle('sheet-open', !!sh);
  document.body.classList.toggle('lock', !!r.lock);
  document.body.classList.toggle('has-bar', !!app.querySelector('.sticky-bar'));
  for (const d of app.querySelectorAll('details')) if (openDetails.has(key(d))) (d as HTMLDetailsElement).open = true;
  const k = `${p.path}/${p.section ?? ''}`;
  if (k === lastKey) {
    window.scrollTo(0, scrollY);
    if (sh && prevSheet) sh.scrollTop = sheetScroll;
  }
  document.title = `${sh ? (sh.getAttribute('aria-label') ?? '') + ' · ' : ''}${r.title} · Capital OS`;
}

/** Прокрутить к блоку раздела и подсветить его (переход по ссылке «#/экран/раздел»). */
function focusSection(section: string): void {
  const el = document.getElementById(`sec-${section}`);
  if (!el) return;
  for (let q: HTMLElement | null = el; q; q = q.parentElement) if (q instanceof HTMLDetailsElement) q.open = true;
  el.scrollIntoView({ block: 'start' });
  window.scrollBy(0, -16);
  el.classList.add('flash');
}

export async function start(): Promise<void> {
  initTheme();
  await loadState();
  window.addEventListener('hashchange', () => {
    const p = parseHash();
    const k = `${p.path}/${p.section ?? ''}`;
    const screenChanged = k !== lastKey;
    if (!p.sheet) sheetOpenedInApp = false;
    render();
    if (screenChanged) {
      hideToast();
      window.scrollTo(0, 0);
      if (p.section) focusSection(p.section);
      // фокус на заголовок экрана — для чтения с экрана и клавиатуры
      if (!p.sheet) (document.getElementById('screen-title') as HTMLElement | null)?.focus({ preventScroll: true });
    }
    lastKey = k;
  });
  subscribe(render);
  initInstall(render);
  const p0 = parseHash();
  lastKey = `${p0.path}/${p0.section ?? ''}`;
  render();
  if (p0.section) focusSection(p0.section);
  const env = (import.meta as unknown as { env?: { PROD?: boolean } }).env;
  if ('serviceWorker' in navigator && env?.PROD) {
    navigator.serviceWorker
      .register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        // файлы, загруженные до того, как service worker взял страницу, — в кэш, чтобы первое же открытие без сервера работало
        const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.startsWith(location.origin));
        reg.active?.postMessage({ type: 'cache', urls: [location.href.split('#')[0], ...urls] });
      })
      .catch((e) => console.warn('SW не зарегистрирован', e));
  }
}
