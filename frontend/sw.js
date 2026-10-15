// GalaxyPulse Service Worker —— v17: klines fallback + 最终稳定版
const CACHE = 'galaxypulse-v17';
const APP_SHELL = ['./', './index.html', './styles.css?v=17', './styles.mobile.css?v=17', './app.js?v=17',
                   './manifest.json',
                   './bridge/storage.js?v=17', './bridge/backend.js?v=17',
                   './bridge/service.js?v=17', './bridge/api.js?v=17',
                   './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(APP_SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;           // 跨域不接管

  // API: 仅网络; 失败返回明确 JSON
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(req).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // bridge/*.js (JS 后端): 网络优先, 紧跟代码迭代
  if (url.pathname.startsWith('/bridge/')) {
    e.respondWith(
      fetch(req).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return r;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // HTML: 网络优先, 断网回落缓存 (保证入口永远拿到最新版)
  if (req.mode === 'navigate' || /\.html$/.test(url.pathname)) {
    e.respondWith(
      fetch(req).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return r;
      }).catch(() => caches.match(req).then((h) => h || caches.match('./index.html')))
    );
    return;
  }

  // 静态资源: stale-while-revalidate —— 先秒回缓存, 后台拉新版写入
  e.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req).then((r) => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return r;
      }).catch(() => hit);
      return hit || refresh;
    })
  );
});
