// Minimal service worker: makes the app installable and serves a cached shell
// if the network is briefly unavailable. Network-first so users always get the
// latest; falls back to cache only when offline.
const CACHE = "eei-shell-v2";
const SHELL = ["/", "/sign-in", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Show a push alert when the server sends one (works with the app closed).
self.addEventListener("push", (e) => {
  let data = { title: "EEI Field Reports", body: "Something needs your attention.", url: "/" };
  try {
    if (e.data) data = { ...data, ...e.data.json() };
  } catch {
    /* keep defaults */
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/" },
      tag: "eei-action-needed", // newer alert replaces the old one instead of stacking
      renotify: true,
    }),
  );
});

// Tapping the alert opens (or focuses) the app.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = e.notification.data?.url || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Only handle same-origin GET navigations/assets; never touch API or auth calls.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api")) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
  );
});
