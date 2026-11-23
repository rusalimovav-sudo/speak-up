// Офлайн-кэш: отдаём из кэша сразу, в фоне обновляем. Меняй VERSION при выпуске новой версии.
const VERSION = 'su-v5';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'data/core.json', 'data/travel.json', 'data/social.json', 'data/lessons.json',
  'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok && new URL(e.request.url).origin === location.origin) cache.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
