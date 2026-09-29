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

export async function alertsState(): Promise<AlertState> {
  if (typeof window === "undefined") return "off";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "blocked";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "on" : "off";
  } catch {
    return "off";
  }
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

  const save = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  return save.ok ? "on" : "off";
}
