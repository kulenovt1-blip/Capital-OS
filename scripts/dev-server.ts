/**
 * Запасной dev-сервер на Bun (`bun scripts/dev-server.ts`), если Vite недоступен.
 * Собирает app/boot.ts при каждом запросе страницы и раздаёт public/. Основной путь — `npm run dev` (Vite).
 */
// @ts-nocheck — скрипт для Bun
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const PORT = Number(process.env.PORT ?? 5173);

async function bundle() {
  const r = await Bun.build({ entrypoints: [join(ROOT, 'app/boot.ts')], target: 'browser', sourcemap: 'inline', define: { 'import.meta.env.PROD': 'false' } });
  if (!r.success) throw new AggregateError(r.logs, 'Сборка не удалась');
  const js = r.outputs.find((o) => o.path.endsWith('.js'));
  const css = r.outputs.find((o) => o.path.endsWith('.css'));
  return { js: await js.text(), css: css ? await css.text() : '' };
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      let html = await Bun.file(join(ROOT, 'index.html')).text();
      html = html.replace('<script type="module" src="./app/boot.ts"></script>', '<link rel="stylesheet" href="./bundle.css" /><script type="module" src="./bundle.js"></script>');
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/bundle.js' || url.pathname === '/bundle.css') {
      try {
        const b = await bundle();
        return url.pathname.endsWith('.js') ? new Response(b.js, { headers: { 'content-type': 'text/javascript' } }) : new Response(b.css, { headers: { 'content-type': 'text/css' } });
      } catch (e) {
        console.error(e);
        return new Response(String(e), { status: 500 });
      }
    }
    const f = Bun.file(join(ROOT, 'public', url.pathname));
    if (await f.exists()) return new Response(f);
    return new Response('not found', { status: 404 });
  },
});
console.log(`Capital OS: http://localhost:${PORT}`);
