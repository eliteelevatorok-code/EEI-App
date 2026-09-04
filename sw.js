/* Service worker for the Elite Elevator field app.

   Strategy: NETWORK-FIRST for the app's own files, so a new version is picked up
   the instant there's a signal (updates land like a normal app - no clearing, no
   reinstall). The cache is the OFFLINE fallback only, so the app still opens and
   runs in a machine room with no signal. Fonts stay cache-first (they never
   change and we don't want a dead signal swapping the typeface).
   Bump CACHE on any change so the old offline copy is thrown away. */

const CACHE = "eei-field-v25";

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
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== self.location.origin && !isFont) return;

  // Fonts: cache-first.
  if (isFont) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res && res.ok) cache.put(req, res.clone()); return res; }
      catch (e) { return new Response("", { status: 504 }); }
    })());
    return;
  }

  // The app's own files: NETWORK-FIRST. Always try the latest; cache is only the
  // fallback when the network is unreachable (offline in the field).
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      const hit = await cache.match(req);
      if (hit) return hit;
      if (req.mode === "navigate") {
        const shell = await cache.match("./report.html") || await cache.match("./index.html");
        if (shell) return shell;
      }
      return new Response("", { status: 504, statusText: "Offline" });
    }
  })());
});
