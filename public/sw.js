// Service worker: makes the app installable, fast, and usable on a bad signal.
//   - The app's code, styles, fonts and icons (/_next/static/…, icons) never
//     change once published (their file names change instead), so they're served
//     straight from the phone after the first visit — no waiting on the network.
//   - Pages are network-first so you always get the latest version; the saved
//     copy is used only when offline.
//   - API calls and sign-in are never touched.
const CACHE = "eei-shell-v6";
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

// Tapping the alert opens the app AT the elevator that needs you. If a window is
// already open, navigate it to the target (don't just focus it wherever it was).
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = e.notification.data?.url || "/";
  e.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of list) {
        if ("focus" in c) {
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

// Files whose name changes whenever their content does — safe to serve from the phone.
// (The icons keep their names: bump CACHE above whenever they're regenerated.)
const isForever = (url) =>
  url.pathname.startsWith("/_next/static/") || /\.(png|ico|woff2?|webmanifest)$/.test(url.pathname);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api")) return;

  if (isForever(url)) {
    // Phone first; fetch (and keep) only if it isn't saved yet.
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Pages: network first, saved copy when offline.
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
