// Service worker: lets the app open with no signal. Same-origin files are served from the saved
// copy and refreshed in the background. Calls to the backend are never touched.
// Bump CACHE when you ship a new version, so the old saved copy is thrown away.
var CACHE = 'expense-log-v6';
var SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'line.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' skips the browser's own HTTP cache (GitHub Pages keeps files for 10 minutes)
      .then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(new Request(u, { cache: 'reload' })); })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(r, { ignoreSearch: true }).then(function (hit) {
      // Always ask the server for the newest copy in the background ('no-cache' = revalidate).
      var net = fetch(r.url, { cache: 'no-cache' }).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(r, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
