// Minimal service worker: makes the app installable and serves a cached shell
// if the network is briefly unavailable. Network-first so users always get the
// latest; falls back to cache only when offline.
const CACHE = "eei-shell-v4";
const SHELL = ["/", "/sign-in", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

// iPhone home-screen apps ignore the link on a tapped alert and just open the
// start page. So on tap we also park the destination here; the app picks it up
// when it opens or comes to the front (see takePendingOpen in push-client.ts).
const PENDING = "eei-pending";
const PENDING_KEY = "/__pending-open";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  const keep = [CACHE, PENDING];
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
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

// Tapping the alert opens the app AT the elevator that needs you. If a window is
// already open, navigate it to the target (don't just focus it wherever it was).
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = e.notification.data?.url || "/";
  e.waitUntil(
    (async () => {
      // Park the destination first (iPhone fallback), then nudge any open window.
      try {
        const box = await caches.open(PENDING);
        await box.put(PENDING_KEY, new Response(target));
      } catch {
        /* storage blocked — the link below still works on Android/desktop */
      }
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of list) {
        if ("focus" in c) {
          c.postMessage({ type: "open-elevator" });
          await c.focus();
          if ("navigate" in c) {
            try {
              await c.navigate(target);
            } catch {
              /* cross-origin or unsupported — the focus still brought the app up */
            }
          }
          return;
        }
      }
      return self.clients.openWindow(target);
    })(),
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
