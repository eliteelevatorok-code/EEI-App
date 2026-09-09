import webpush from "web-push";
import { appendRow, readRange, writeCell } from "@/lib/google";

// Web-push alerts. Keys and the run-secret live in the private "Config" tab
// (only the robot account reads it) because the hosting settings page is not
// reachable to set env vars. Subscriptions live in the "PushSubs" tab.

type PushConfig = { publicKey: string; privateKey: string; contact: string; runSecret: string };

let cached: PushConfig | null = null;
export async function getPushConfig(): Promise<PushConfig> {
  if (cached) return cached;
  const rows = await readRange("Config!A1:B10");
  const map = new Map(rows.map((r) => [(r[0] ?? "").trim(), (r[1] ?? "").trim()]));
  cached = {
    publicKey: map.get("vapidPublic") ?? "",
    privateKey: map.get("vapidPrivate") ?? "",
    contact: map.get("pushContact") ?? "mailto:elite.elevator.ok@gmail.com",
    runSecret: map.get("pushRunSecret") ?? "",
  };
  return cached;
}

type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };

// Save a phone's subscription (upsert by endpoint).
export async function saveSubscription(sub: Sub): Promise<void> {
  const rows = await readRange("PushSubs!A2:C");
  const exists = rows.some((r) => (r[0] ?? "") === sub.endpoint);
  if (exists) return;
  await appendRow("PushSubs!A:C", [sub.endpoint, JSON.stringify(sub), new Date().toISOString()]);
}

async function getSubscriptions(): Promise<{ sub: Sub; row: number }[]> {
  const rows = await readRange("PushSubs!A2:C");
  const out: { sub: Sub; row: number }[] = [];
  rows.forEach((r, i) => {
    if (!r[1]) return;
    try {
      out.push({ sub: JSON.parse(r[1]) as Sub, row: 2 + i });
    } catch {
      /* skip bad row */
    }
  });
  return out;
}

// Blank a dead subscription's cells (endpoint returned 404/410).
async function dropSubscription(row: number): Promise<void> {
  await writeCell(`PushSubs!A${row}`, "");
  await writeCell(`PushSubs!B${row}`, "");
}

// ---- what needs a human, read from the Elevators tab ----
const cell = (r: string[], i: number) => (r[i] ?? "").trim();

// Returns one "YOUR MOVE" line per row that is waiting on a person (mirrors the
// sheet's Next action column, keeping only the human-action states).
export async function actionNeeded(): Promise<{ building: string; okla: string; what: string }[]> {
  const rows = await readRange("Elevators!A2:AJ");
  const out: { building: string; okla: string; what: string }[] = [];
  for (const r of rows) {
    if (!cell(r, 0)) continue;
    const S = cell(r, 18), T = cell(r, 19), U = cell(r, 20), V = cell(r, 21), W = cell(r, 22),
      X = cell(r, 23), Y = cell(r, 24), AA = cell(r, 26), AB = cell(r, 27), AD = cell(r, 29);
    let what = "";
    if (AD === "Paid") what = "";
    else if (AB === "Sent") what = "record the payment";
    else if (AA === "Sent") what = "send the invoice";
    else if (Y === "Inspected") what = "";
    else if (Y === "Booked") what = "do the inspection";
    else if (X === "Sent") what = "book the visit";
    else if (W === "Answered") what = "";
    else if (W === "Waiting") what = "chase the maintenance company";
    else if (V === "Sent") what = "log the maintenance answer";
    else if (U === "Received") what = "";
    else if (U === "Awaiting") what = "log the customer PO";
    else if (T === "Sent") what = "waiting on the customer PO";
    if (what) out.push({ building: cell(r, 1), okla: cell(r, 0), what });
  }
  return out;
}

// Send an alert to every subscribed phone. Prunes dead subscriptions.
export async function sendAlert(title: string, body: string, url = "/"): Promise<{ sent: number; pruned: number }> {
  const cfg = await getPushConfig();
  if (!cfg.publicKey || !cfg.privateKey) return { sent: 0, pruned: 0 };
  webpush.setVapidDetails(cfg.contact, cfg.publicKey, cfg.privateKey);
  const subs = await getSubscriptions();
  const payload = JSON.stringify({ title, body, url });
  let sent = 0, pruned = 0;
  for (const { sub, row } of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await dropSubscription(row);
        pruned++;
      }
    }
  }
  return { sent, pruned };
}
