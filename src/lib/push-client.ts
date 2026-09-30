"use client";

// Browser side of push alerts: ask permission, sign this phone up with Google's
// push service, and hand that sign-up to the server so the hourly check can buzz
// it later.
//
// "On" must really mean on. A phone's sign-up can die without the phone noticing
// (Google refreshes it, the app is reinstalled, the alert keys change); the server
// then drops it and alerts silently stop. So every time the app opens, and every
// time Settings asks, ensureSignedUp() checks the whole chain and repairs it:
// no sign-up → make one; sign-up made with old keys → replace it; server says
// Google called it dead → replace it. Permission was already given, so no tap
// is needed.

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type AlertState = "unsupported" | "off" | "on" | "blocked";

const supported = () =>
  typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;

// The server's current public alert key (null if it can't be fetched).
async function serverKey(): Promise<Uint8Array | null> {
  try {
    const res = await fetch("/api/push/key");
    if (!res.ok) return null;
    const { publicKey } = (await res.json()) as { publicKey?: string };
    return publicKey ? urlBase64ToUint8Array(publicKey) : null;
  } catch {
    return null;
  }
}

const sameBytes = (a: ArrayBuffer | null | undefined, b: Uint8Array) => {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

// Hand this phone's sign-up to the server's list (PushSubs). Safe to repeat.
// null = couldn't reach the server (e.g. offline).
async function sendToServer(sub: PushSubscription): Promise<{ ok: boolean; renew: boolean } | null> {
  try {
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    const d = (await res.json().catch(() => ({}))) as { renew?: boolean };
    return { ok: res.ok, renew: !!d.renew };
  } catch {
    return null;
  }
}

// Make sure this phone will really get alerts (permission must already be
// granted). Returns "on" / "off", or null when offline (can't check right now).
async function ensureSignedUp(): Promise<"on" | "off" | null> {
  const reg = await navigator.serviceWorker.ready;
  const key = await serverKey();
  if (!key) return null;
  const fresh = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });

  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameBytes(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe(); // made with old alert keys — it can never work again
    sub = null;
  }
  if (!sub) sub = await fresh();

  let saved = await sendToServer(sub);
  if (saved?.renew) {
    await sub.unsubscribe(); // Google said this one is dead — get a new one
    sub = await fresh();
    saved = await sendToServer(sub);
  }
  if (!saved) return null;
  return saved.ok ? "on" : "off";
}

// What Settings shows. Checks — and repairs — the whole chain each time.
export async function alertsState(): Promise<AlertState> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  try {
    return (await ensureSignedUp()) === "off" ? "off" : "on";
  } catch {
    return "off";
  }
}

// On every app open: repair the chain if needed, then tell the server log this
// phone's alert status (see /api/push/state) so a problem is never a guess.
export async function resyncAlerts(): Promise<void> {
  const ok = supported();
  const permission = ok ? Notification.permission : "n/a";
  let result: string = "not-checked";
  if (ok && permission === "granted") {
    try {
      result = String(await ensureSignedUp());
    } catch (err) {
      result = "error: " + (err instanceof Error ? err.message : String(err));
    }
  }
  await fetch("/api/push/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supported: ok, permission, signedUp: result, saved: result === "on" }),
  }).catch(() => {});
}

// Turn alerts on for this phone (the Settings button). Returns the resulting state.
export async function enableAlerts(): Promise<AlertState> {
  if (!supported()) return "unsupported";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "blocked" : "off";
  try {
    return (await ensureSignedUp()) === "on" ? "on" : "off";
  } catch {
    return "off";
  }
}
