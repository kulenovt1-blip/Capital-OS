// Service worker: кэш оболочки приложения для работы без сервера. Данные пользователя — в IndexedDB, сюда не попадают.
const CACHE = 'capital-os-v3';
// файл, присланный через «Поделиться → Capital OS» (D183): лежит здесь, пока страница импорта его не заберёт
const SHARE = 'capital-os-share';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// страница присылает файлы, загруженные до того, как service worker её взял (D73)
self.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.type !== 'cache' || !Array.isArray(d.urls)) return;
  const urls = d.urls.filter((u) => typeof u === 'string' && new URL(u).origin === location.origin);
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(urls.map((u) => c.add(u).catch(() => undefined)))));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  // «Поделиться → Capital OS»: принять файл, спрятать в кэш и открыть «Импорт»; сам файл никуда не отправляется
  if (req.method === 'POST' && new URL(req.url).origin === location.origin && new URL(req.url).pathname.endsWith('/share-target')) {
    e.respondWith(
      (async () => {
        try {
          const file = (await req.formData()).get('file');
          if (file && typeof file !== 'string') {
            const c = await caches.open(SHARE);
            await c.put('shared-file', new Response(file, { headers: { 'x-file-name': encodeURIComponent(file.name || 'MoneyManager.mmbackup') } }));
          }
        } catch (_) { /* файл не принят — страница импорта покажет обычный выбор */ }
        return Response.redirect(new URL('./#/import', self.registration.scope).href, 303);
      })(),
    );
    return;
  }
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // сеть в приоритете (обновления приходят сразу), кэш — когда сервер не запущен
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
