// v3 — network-first for the app's own files so deployed updates actually
// reach installed PWAs (the old cache-first strategy served stale code
// forever). Cache is the offline fallback, not the primary source.
const CACHE_NAME = 'cal-v7';
const ASSETS = [
  './',
  './index.html',
  './ui.css',
  './style.css',
  './app.js',
  './store.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './hala.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const sameOrigin = req.url.startsWith(self.location.origin);
  if (!sameOrigin) return; // let API/CDN requests pass through untouched

  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))
      )
  );
});
