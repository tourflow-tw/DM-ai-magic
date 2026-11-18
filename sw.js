const CACHE_NAME = 'dm-ai-magic-pages-v1.02';
const APP_FILES = [
  './', './index.html', './app.js', './style.css', './mobile.css',
  './manifest.webmanifest', './assets/demo-thailand-web.jpg',
  './assets/icon-192.png', './assets/icon-512.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).then(response => {
    if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache => cache.put(request, copy));}
    return response;
  }).catch(() => caches.match(request).then(cached => cached || caches.match('./index.html'))));
});
