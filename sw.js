/* SHIVAM PIXA — Service Worker
   Update rule: when a new version arrives, the old cache is deleted and the app refreshes itself. */

const VERSION = 'v3.15.0';
const CACHE = `shivam-pixa-${VERSION}`;
/* photos arriving from the Android "Share → PIXA" share target land here
   first; the page picks them up (see receiveShared in index.html) */
const SHARE_CACHE = 'shivam-pixa-shared-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './js/fx.js',
  './js/editor.js',
  './js/collage.js',
  './js/cloud.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/logo-ring.png',
  './icons/logo-core.png',
  './icons/favicon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

/* ================= share target (Android: Share → PIXA) =================
   When photos are shared to the installed app, the POST is handled here:
   every file is stashed in SHARE_CACHE, then the app window is woken and
   the queue is handed over. The page ingests the files into the library
   and cloud sync backs them up to Google Drive automatically. */
async function handleSharePost(request) {
  const stashed = [];
  try {
    const form = await request.formData();
    const files = [
      ...form.getAll('photos'), ...form.getAll('files'), ...form.getAll('file'), ...form.getAll('image')
    ].filter((v) => v instanceof File && v.size > 0);
    if (files.length) {
      const cache = await caches.open(SHARE_CACHE);
      const stamp = Date.now();
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const safeName = f.name && /\.[a-z0-9]{1,5}$/i.test(f.name) ? f.name : `${f.name || 'photo'}.jpg`;
        const key = `${location.origin}/__shared__/${stamp}-${i}-${safeName.replace(/[^\w.\- ]+/g, '_')}`;
        await cache.put(key, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
        stashed.push(key);
      }
      /* persistent queue index, so the page can pick the files up even if
         the postMessage races with a fresh window opening */
      const prev = await cache.match(`${location.origin}/__shared__/__queue__`);
      let queue = [];
      try { queue = (await prev.json()).keys || []; } catch (err) {}
      await cache.put(
        `${location.origin}/__shared__/__queue__`,
        new Response(JSON.stringify({ keys: queue.concat(stashed), at: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json' } })
      );
    }
  } catch (err) { /* malformed share — still open the app */ }

  /* wake the app and hand over the queue */
  const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (cs.length) {
    cs.forEach((c) => c.postMessage({ type: 'SHARED_FILES', keys: stashed }));
    const vis = cs.find((c) => c.visibilityState === 'visible') || cs[0];
    try { await vis.focus(); } catch (err) {}
  } else {
    await self.clients.openWindow('./?shared=1');
  }
  return Response.redirect(new URL('?shared=1', request.url).href, 303);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  /* share-target upload: a navigate POST carrying multipart form data */
  if (
    e.request.method === 'POST' &&
    e.request.mode === 'navigate' &&
    (e.request.headers.get('content-type') || '').includes('multipart/form-data')
  ) {
    e.respondWith(handleSharePost(e.request));
    return;
  }

  // App pages: network-first (so updates arrive instantly), cache for offline
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets: cache-first
  if (e.request.method === 'GET') {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(e.request, copy));
            }
            return res;
          })
      )
    );
  }
});
