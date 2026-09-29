import webpush from "web-push";
import { appendRow, readRange, writeCells } from "@/lib/google";
import { readConfig, writeConfig } from "@/lib/config";
import { cell, readRows } from "@/lib/sheet";
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
  const map = await readConfig();
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
  await writeCells(["A", "B", "C"].map((c) => [`PushSubs!${c}${row}`, ""]));
}

// ---- what needs a human, read from the Elevators tab ----

// One thing that needs a PERSON. The automation sends the emails and invoices,
// and the PO/maintenance forms and QuickBooks handle their own steps — so only
// three things buzz the phone:
//   inspect — a visit is booked: go do the inspection
//   chase   — the maintenance company hasn't answered the records request
//   overdue — past the due date and no visit booked or done
// `key` identifies the item so the same thing isn't announced twice.
export type AlertItem = { key: string; okla: string; building: string; title: string; body: string };

// Today's date in Oklahoma, as a comparable yyyymmdd number.
function todayNum(): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date());
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return get("year") * 10000 + get("month") * 100 + get("day");
}
// "9/28/2026" or "2026-09-28" → 20260928 (0 if unreadable).
function dateNum(s: string): number {
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return +m[3] * 10000 + +m[1] * 100 + +m[2];
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? +m[1] * 10000 + +m[2] * 100 + +m[3] : 0;
}

// "10/3/2026" → "Saturday, October 3" (adds the year if it isn't this year).
function humanDate(s: string): string {
  const n = dateNum(s);
  if (!n) return s;
  const d = new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
  const sameYear = Math.floor(n / 10000) === Math.floor(todayNum() / 10000);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

// Everything that needs a person right now. Master switch off = nothing.
// Wording is written the way you'd say it to someone — no system terms.
export async function alertItems(): Promise<AlertItem[]> {
  if (!(await isMasterOn())) return [];
  const today = todayNum();
  const out: AlertItem[] = [];
  for (const r of await readRows()) {
    const okla = cell(r, "okla");
    if (!okla || isRowPaused(r)) continue; // blank row, or a paused elevator
    const building = cell(r, "building");
    const visit = cell(r, "visit");
    if (visit === "Booked") {
      const trip = cell(r, "tripDay");
      const when = dateNum(trip);
      out.push({
        key: `inspect:${okla}:${trip}`,
        okla,
        building,
        title:
          when === today
            ? `You're inspecting ${building} today`
            : when
              ? `${building} is booked for ${humanDate(trip)}`
              : `${building} has a visit booked`,
        body:
          when === today
            ? "Tap when you get there to start the report."
            : "Tap to see the details before you go.",
      });
    }
    if (cell(r, "maintConfirm") === "Waiting") {
      const co = cell(r, "maintCo");
      out.push({
        key: `chase:${okla}`,
        okla,
        building,
        title: `Still waiting on records for ${building}`,
        body: `${co || "The maintenance company"} hasn't told us how the last inspection went. Give them a call or send a quick email.`,
      });
    }
    const due = dateNum(cell(r, "due"));
    if (due && due < today && visit !== "Booked" && visit !== "Inspected") {
      out.push({
        key: `overdue:${okla}:${cell(r, "due")}`,
        okla,
        building,
        title: `${building} is past due`,
        body: `It was due ${humanDate(cell(r, "due"))} and no visit is booked. Call the customer to set one up.`,
      });
    }
  }
  return out;
}

// What was already announced, kept in the Config tab (row "alertsSent"): the
// day of the last run and the item keys announced. Only items NOT in it are
// new; items that went away drop out, so if one comes back it's announced again.
// A new day means the next run is the morning summary.
const SENT = "alertsSent";
export async function readSent(): Promise<{ day: number; keys: Set<string> }> {
  try {
    const v = JSON.parse((await readConfig()).get(SENT) || "{}") as { day?: number; keys?: string[] };
    return { day: v.day ?? 0, keys: new Set(v.keys ?? []) };
  } catch {
    return { day: 0, keys: new Set() };
  }
}
export async function saveSent(keys: string[]): Promise<void> {
  await writeConfig(SENT, JSON.stringify({ day: todayNum(), keys }));
}
export { todayNum };

// Send an alert to every subscribed phone. Prunes dead subscriptions.
// `tag`: a newer alert with the same tag replaces the older one on the phone
// instead of stacking (the morning summary uses one tag; each item its own).
export async function sendAlert(
  title: string,
  body: string,
  url = "/",
  tag = "eei-summary",
): Promise<{ sent: number; pruned: number }> {
  const cfg = await getPushConfig();
  if (!cfg.publicKey || !cfg.privateKey) return { sent: 0, pruned: 0 };
  webpush.setVapidDetails(cfg.contact, cfg.publicKey, cfg.privateKey);
  const subs = await getSubscriptions();
  const payload = JSON.stringify({ title, body, url, tag });
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
