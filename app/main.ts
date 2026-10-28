/** Точка входа PWA: маршруты по hash, загрузка состояния, регистрация service worker. */
import { initInstall } from './install';
import './styles.css';
import { h, clear } from './dom';
import { loadState, subscribe } from './store';
import { renderImport } from './screens/import';
import { renderOverview } from './screens/overview';
import { renderSettings } from './screens/settings';

export interface Route {
  path: string;
  title: string;
  /** section — второй сегмент адреса (#/settings/savings): к какому блоку прокрутить. */
  render: (rerender: () => void, section?: string) => HTMLElement;
  /** Скрыть из меню (экран остаётся доступен по адресу). */
  hidden?: () => boolean;
}

export const routes: Route[] = [
  { path: 'overview', title: 'Обзор', render: () => renderOverview() },
  { path: 'import', title: 'Импорт', render: (r) => renderImport(r) },
  { path: 'settings', title: 'Настройки', render: (_r, section) => renderSettings(section) },
];

/** Регистрация дополнительных экранов (этапы 2+) до первого рендера. */
export function addRoute(r: Route, beforePath?: string): void {
  const i = beforePath ? routes.findIndex((x) => x.path === beforePath) : -1;
  if (i >= 0) routes.splice(i, 0, r);
  else routes.push(r);
}

const app = document.getElementById('app')!;

function parseHash(): { path: string; section?: string } {
  const [path = '', section] = location.hash.replace(/^#\/?/, '').split('/');
  return section ? { path, section } : { path };
}

function current(): Route {
  const { path } = parseHash();
  return routes.find((r) => r.path === path) ?? routes[0]!;
}

/** Прокрутить к блоку раздела и подсветить его (переход из «Исправить» и «Первых шагов»). */
function focusSection(section: string): void {
  const el = document.getElementById(`sec-${section}`);
  if (!el) return;
  if (el instanceof HTMLDetailsElement) el.open = true;
  // раздел может лежать в свёрнутом блоке («Редко нужно») — раскрываем всё вокруг
  for (let p = el.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true;
  // вложенные формы («+ Добавить…») не раскрываем: раздел показывается целиком, но коротким
  el.scrollIntoView({ block: 'start' });
  window.scrollBy(0, -64);
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1800);
}

function render(): void {
  const r = current();
  const { section } = parseHash();
  const scrollY = window.scrollY;
  const key = (d: Element) => (d as HTMLElement).dataset.key ?? d.querySelector(':scope > summary')?.textContent ?? '';
  const openDetails = new Set([...app.querySelectorAll('details[open]')].map(key));
  clear(app);
  app.append(
    h('header', { class: 'top' }, h('div', { class: 'brand' }, 'Capital OS'), h('nav', null, routes.filter((x) => x === r || !x.hidden?.()).map((x) => h('a', { href: `#/${x.path}`, class: x === r ? 'active' : '' }, x.title)))),
    h('main', null, h('h1', null, r.title), r.render(render, section)),
  );
  // сохранить раскрытые блоки и прокрутку после перерисовки
  for (const d of app.querySelectorAll('details')) if (openDetails.has(key(d))) (d as HTMLDetailsElement).open = true;
  window.scrollTo(0, scrollY);
  document.title = `${r.title} · Capital OS`;
}

export async function start(): Promise<void> {
  await loadState();
  window.addEventListener('hashchange', () => {
    render();
    window.scrollTo(0, 0);
    const { section } = parseHash();
    if (section) focusSection(section);
  });
  subscribe(render);
  initInstall(render);
  render();
  const first = parseHash().section;
  if (first) focusSection(first);
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
