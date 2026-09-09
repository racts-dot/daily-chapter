/* Daily Chapter service worker.
   App shell: cache first, so the app opens with no internet.
   Chapter text: network first, falling back to whatever was cached.
   Bump CACHE when index.html changes, or phones keep serving the old one. */
const CACHE = "daily-chapter-v23";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.hostname === "bible-api.com" || url.hostname === "api.nlt.to") {
    event.respondWith(
      fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // The PAGE is fetched fresh first, falling back to the cache when there is
    // no signal. Serving the page from cache first is why an installed copy
    // could sit on an old version for days and nobody could tell.
    const isPage = req.mode === "navigate" || req.destination === "document";
    if (isPage) {
      event.respondWith(
        fetch(req).then(function (res) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        }).catch(function () {
          return caches.match(req).then(function (hit) { return hit || caches.match("./index.html"); });
        })
      );
      return;
    }
    event.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        });
      })
    );
  }
});
