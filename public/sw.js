// Service worker: кэш оболочки приложения для работы без сервера. Данные пользователя — в IndexedDB, сюда не попадают.
const CACHE = 'capital-os-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
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
