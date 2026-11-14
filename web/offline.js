// Registered only after a friend opens the password-protected calculator.
const build = new URL(self.location.href).search;
const cacheName = `solstice-share-${build}`;
const assets = [
  '/', `/app.js${build}`, '/styles.css', '/onboarding.css', '/worker.js',
  '/api.js', '/city-model.js', '/connection.js', '/diagnostics-ui.js', '/geometry.js',
  '/map-ui.js', '/maps.js', '/model.js', '/onboarding.js', '/panels.js', '/providers.js',
  '/runtime.js', '/scene.js', '/sources.js', '/vendor/OrbitControls.js',
  '/vendor/three.core.js', '/vendor/three.module.js',
];
const appUrls = new Set(assets);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(assets);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const oldCaches = (await caches.keys()).filter(name => name.startsWith('solstice-share-') && name !== cacheName);
    await Promise.all(oldCaches.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  const isHome = event.request.mode === 'navigate' && ['/', '/index.html'].includes(url.pathname);
  const asset = isHome ? '/' : url.pathname + url.search;
  if (!appUrls.has(asset)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return (await cache.match(asset)) ?? fetch(event.request);
  })());
});
