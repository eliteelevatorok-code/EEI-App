import webpush from "web-push";
import { appendRow, readRange, writeCell } from "@/lib/google";
import { isMasterOn, isRowPaused } from "@/lib/switches";

// Phone alerts (web push). The signing keys and the scheduler secret live in the
// dashboard's private Config tab, which only the app's Google robot account can
// read. Each subscribed phone is one row in the PushSubs tab.

type PushConfig = { publicKey: string; privateKey: string; contact: string; runSecret: string };

// Read once per server instance and reused — if a key in Config is changed, the
// app picks it up on its next fresh start (e.g. the next deploy).
let cached: PushConfig | null = null;
export async function getPushConfig(): Promise<PushConfig> {
  if (cached) return cached;
  const rows = await readRange("Config!A1:B20");
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

// Blank a dead subscription's row (the phone unsubscribed or reinstalled — the
// push service answered 404/410).
async function dropSubscription(row: number): Promise<void> {
  for (const c of ["A", "B", "C"]) await writeCell(`PushSubs!${c}${row}`, "");
}

// ---- what needs a human, read from the Elevators tab ----
const cell = (r: string[], i: number) => (r[i] ?? "").trim();

// Returns one line per row that is genuinely waiting on a PERSON. The automation
// now sends the emails and invoices, and the PO/maintenance forms and QuickBooks
// handle their own steps — so the only things left for a human are the physical
// inspection once a visit is booked, and chasing the maintenance company when
// they haven't sent records. Everything else is either automatic or waiting on
// the customer, and should NOT buzz the phone. Master switch off = no alerts at all.
export async function actionNeeded(): Promise<{ building: string; okla: string; what: string }[]> {
  if (!(await isMasterOn())) return [];
  const rows = await readRange("Elevators!A2:AL");
  const out: { building: string; okla: string; what: string }[] = [];
  for (const r of rows) {
    if (!cell(r, 0) || isRowPaused(r)) continue; // blank row, or a paused elevator
    const W = cell(r, 22), Y = cell(r, 24); // W = Maint. confirm, Y = Visit
    let what = "";
    if (Y === "Booked") what = "Do the inspection — the visit is booked";
    else if (W === "Waiting") what = "Chase the maintenance company for records";
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
