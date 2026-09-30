"use client";

// Browser side of push alerts: ask permission, subscribe this phone, and hand
// the subscription to the server so the hourly check can buzz it later.

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type AlertState = "unsupported" | "off" | "on" | "blocked";

// Hand this phone's subscription to the server's list (PushSubs). Safe to repeat —
// the server ignores one it already has. true = the server has it; false = the
// server refused it; null = couldn't reach the server (e.g. offline).
async function sendToServer(sub: PushSubscription): Promise<boolean | null> {
  try {
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    return res.ok;
  } catch {
    return null;
  }
}

// "On" means BOTH this phone is subscribed AND the server's list has it. The
// phone alone isn't enough: if the server's copy is lost, the phone still says
// "on" while nothing arrives. So this re-sends the phone's subscription every
// time it's asked — the two can't drift apart.
export async function alertsState(): Promise<AlertState> {
  if (typeof window === "undefined") return "off";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "blocked";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return "off";
    return (await sendToServer(sub)) === false ? "off" : "on";
  } catch {
    return "off";
  }
}

// On every app open: if this phone has alerts on, make sure the server still has
// it — then tell the server log what this phone's alert status is (see
// /api/push/state), so a phone that isn't getting alerts can be diagnosed.
export async function resyncAlerts(): Promise<void> {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const permission = supported ? Notification.permission : "n/a";
  let signedUp = false;
  let saved: boolean | null = null;
  if (supported && permission === "granted") {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    signedUp = !!sub;
    if (sub) saved = await sendToServer(sub);
  }
  await fetch("/api/push/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supported, permission, signedUp, saved }),
  }).catch(() => {});
}

// Turn alerts on for this phone. Returns the resulting state.
export async function enableAlerts(): Promise<AlertState> {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "blocked" : "off";

  const reg = await navigator.serviceWorker.ready;
  const res = await fetch("/api/push/key");
  if (!res.ok) return "off";
  const { publicKey } = (await res.json()) as { publicKey?: string };
  if (!publicKey) return "off";

  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));

  return (await sendToServer(sub)) ? "on" : "off";
}
