// KrogerBuddy service worker — required for PWA installability, gives an offline
// fallback, and is network-first so installed users always get the latest when
// online. Bump CACHE on each deploy so the worker updates and clients refresh.
const CACHE = 'krogerbuddy-v9';
const CORE = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (e) => {
  self.skipWaiting(); // activate the new worker immediately
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Only handle same-origin GETs; let the cross-origin Kroger proxy pass through.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Navigations (the HTML shell) always bypass the HTTP cache so a fresh deploy
  // is never masked by a stale cached page.
  const isNav = req.mode === 'navigate' || req.destination === 'document';
  const fetchReq = isNav ? new Request(req.url, { cache: 'no-store' }) : req;

  e.respondWith(
    fetch(fetchReq)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
