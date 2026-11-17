// Service worker: aplikácia + lokálne kópie Tesseractu fungujú aj bez CDN.
// Pri zmene súborov zvýš VERSION, aby sa stará cache zahodila.
const VERSION = 'v3';
const CACHE = 'titulky-' + VERSION;
const CORE = [
  './', 'index.html', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png',
];
const VENDOR = [
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/eng.traineddata.gz',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(CORE.map(u => c.add(u).catch(() => {})));
    // veľké súbory ukladaj jednotlivo, zlyhanie jedného nezhodí inštaláciu
    await Promise.all(VENDOR.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('titulky-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html');
  if (isPage) {
    // stránka: najprv sieť (aby prišli aktualizácie), potom cache
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        if (r.ok) { const c = await caches.open(CACHE); c.put('index.html', r.clone()); }
        return r;
      } catch (err) {
        return (await caches.match(req, { ignoreSearch: true })) || (await caches.match('index.html')) || Response.error();
      }
    })());
    return;
  }
  // ostatné: najprv cache, potom sieť (a doplň do cache)
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const r = await fetch(req);
    if (r.ok) { const c = await caches.open(CACHE); c.put(req, r.clone()); }
    return r;
  })());
});
