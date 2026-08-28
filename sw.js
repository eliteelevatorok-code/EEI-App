/* Service worker for the Elite Elevator field app.

   Everything the app needs is cached on install, so once it is on the home
   screen it opens and runs with no signal at all. Bump CACHE when any file
   changes - the old cache is thrown away and the new files take over. */

const CACHE = "eei-field-v17";

const SHELL = [
  "./",
  "./index.html",
  "./report.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Added one at a time so one missing file cannot fail the whole install.
    await Promise.all(SHELL.map(url =>
      cache.add(new Request(url, { cache: "reload" })).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // The Google Fonts stylesheet and font files: use the cached copy first so a
  // dead signal never leaves the app in a fallback face, refresh it in the
  // background when there is a connection.
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

  if (url.origin !== self.location.origin && !isFont) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: false });

    if (hit) {
      // Refresh quietly for next time; failure here is fine, we already served.
      event.waitUntil(
        fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {})
      );
      return hit;
    }

    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      // Offline and never cached. For a page request, hand back the app itself
      // so the home screen icon always opens to something that works.
      if (req.mode === "navigate") {
        const shell = await cache.match("./index.html");
        if (shell) return shell;
      }
      return new Response("", { status: 504, statusText: "Offline" });
    }
  })());
});
