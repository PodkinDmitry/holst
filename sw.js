/* Холст: offline cache. The page itself is fetched fresh when online,
   and served from cache when there is no connection. */
const CACHE = 'holst-v21';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Google, YouTube and other sites go straight to the network
  if (url.searchParams.has('vcheck')) return; // version check always goes to the site
  if (req.mode === 'navigate') {
    e.respondWith(
      withTimeout(fetch(req, { cache: 'no-store' }), 15000)
        .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); } return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
/* «Поделиться» from other apps on the phone: the files and the text wait in a cache, the page picks them up */
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'POST' || url.origin !== location.origin || !url.pathname.endsWith('/share')) return;
  e.respondWith((async () => {
    try {
      const fd = await req.formData(), c = await caches.open('holst-share'), files = [];
      let i = 0; for (const f of fd.getAll('files')) { if (!f || !f.size) continue; const key = './__share/f' + i++; await c.put(key, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } })); files.push({ key, name: f.name || 'file', type: f.type || '' }); }
      await c.put('./__share/meta', new Response(JSON.stringify({ title: fd.get('title') || '', text: fd.get('text') || '', url: fd.get('url') || '', files }), { headers: { 'Content-Type': 'application/json' } }));
    } catch (er) { /* the page opens anyway */ }
    return Response.redirect('./?share=1', 303);
  })());
});
