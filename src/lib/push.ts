import webpush from "web-push";
import { appendRow, readRange, writeCells } from "@/lib/google";
import { readConfig, writeConfig } from "@/lib/config";
import { cell, readRows } from "@/lib/sheet";
import { isMasterOn, isRowPaused } from "@/lib/switches";
import { finishedReport } from "@/lib/report";
import { safetyAnswer } from "@/lib/records";
import { dueReminders, readReminders } from "@/lib/reminders";

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

// PushSubs columns: A endpoint (the phone's address at Google's push service),
// B the full subscription, C when it was added, D "gone …" once Google says that
// address no longer works.
//
// Save a phone's subscription. Returns:
//   "saved" — new, added to the list
//   "known" — already on the list and working
//   "gone"  — Google already said this address is dead, so the phone must get a
//             FRESH sign-up (push-client.ts does that on its own, no tap needed)
export async function saveSubscription(sub: Sub): Promise<"saved" | "known" | "gone"> {
  const rows = await readRange("PushSubs!A2:D");
  const hit = rows.find((r) => (r[0] ?? "") === sub.endpoint);
  if (hit) return hit[3] ? "gone" : "known";
  await appendRow("PushSubs!A:D", [sub.endpoint, JSON.stringify(sub), new Date().toISOString(), ""]);
  return "saved";
}

async function getSubscriptions(): Promise<{ sub: Sub; row: number }[]> {
  const rows = await readRange("PushSubs!A2:D");
  const out: { sub: Sub; row: number }[] = [];
  rows.forEach((r, i) => {
    if (!r[1] || r[3]) return; // blank, or marked gone
    try {
      out.push({ sub: JSON.parse(r[1]) as Sub, row: 2 + i });
    } catch {
      /* skip bad row */
    }
  });
  return out;
}

// Google's push service said this phone's address no longer works (404/410 —
// e.g. Google refreshed it, or the app was reinstalled). Keep the address but
// mark it gone, so when that phone next opens the app it's told to sign up fresh.
async function dropSubscription(row: number): Promise<void> {
  await writeCells([
    [`PushSubs!B${row}`, ""],
    [`PushSubs!D${row}`, `gone ${new Date().toISOString()}`],
  ]);
}

// ---- what needs a human, read from the Elevators tab ----

// One thing that needs a PERSON. The automation sends the emails and invoices,
// and the PO/maintenance forms and QuickBooks handle their own steps — so only
// these things buzz the phone:
//   inspect — a visit is booked: go do the inspection
//   chase   — no answer yet on the safety test (asked of American Elevator, or the customer)
//   report  — the visit is marked done but its report was never finished (so it can't be emailed)
//   overdue — past the due date and no visit booked or done
//   nopass  — the safety-test answer was No (no passing test in 12 months)
//   noprice — no price on it, inside the 60-day window (the quote can't go out)
//   remind  — a reminder Robert set through the assistant (see reminders.ts)
// Each alert is ONE short line — what and which building. Tapping it opens the
// elevator, whose "Next step" card explains and has the button to act.
// `key` identifies the item so the same thing isn't announced twice.
export type AlertItem = { key: string; okla: string; building: string; title: string };

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
// yyyymmdd + n days → yyyymmdd.
function addDaysNum(n: number, days: number): number {
  const d = new Date(Date.UTC(Math.floor(n / 10000), (Math.floor(n / 100) % 100) - 1, (n % 100) + days));
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

// "10/3/2026" → "Sat, Oct 3" (short, for a one-line alert).
function shortDate(n: number): string {
  const d = new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// Everything that needs a person right now. Master switch off = nothing
// (`ignoreMaster` is only for the test alert — see /api/push/run?test=1).
export async function alertItems(ignoreMaster = false): Promise<AlertItem[]> {
  if (!ignoreMaster && !(await isMasterOn())) return [];
  const today = todayNum();
  const out: AlertItem[] = [];
  for (const r of await readRows()) {
    const okla = cell(r, "okla");
    if (!okla || isRowPaused(r)) continue; // blank row, or a paused elevator
    const building = cell(r, "building");
    const visit = cell(r, "visit");
    const add = (key: string, title: string) => out.push({ key, okla, building, title });
    if (visit === "Booked") {
      const trip = cell(r, "tripDay");
      const when = dateNum(trip);
      add(
        `inspect:${okla}:${trip}`,
        when === today ? `Inspection today: ${building}` : when ? `Booked ${shortDate(when)}: ${building}` : `Visit booked: ${building}`,
      );
    }
    if (cell(r, "maintConfirm") === "Waiting") add(`chase:${okla}`, `Safety test missing: ${building}`);
    // The answer was No (no passing test in 12 months) — a person has to decide what happens.
    if (safetyAnswer(cell(r, "safetyTest")) === "No" && visit !== "Inspected") add(`nopass:${okla}`, `No passing safety test: ${building}`);
    // No price → the quote (and later the bill) can't go out. Flag it once it's inside the 60-day window.
    const dueIn = dateNum(cell(r, "due"));
    if (!/[1-9]/.test(cell(r, "price")) && cell(r, "quote") !== "Sent" && dueIn && dueIn <= addDaysNum(today, 60)) add(`noprice:${okla}`, `Price missing: ${building}`);
    if (visit === "Inspected" && cell(r, "report") !== "Sent") {
      // The report email (customer + state) waits for the finished report. If
      // Drive can't be checked right now, say nothing rather than guess.
      const done = await finishedReport(r).catch(() => true);
      if (!done) add(`report:${okla}:${cell(r, "tripDay")}`, `Report not finished: ${building}`);
    }
    const due = dateNum(cell(r, "due"));
    if (due && due < today && visit !== "Booked" && visit !== "Inspected") add(`overdue:${okla}:${cell(r, "due")}`, `Past due: ${building}`);
  }
  // Robert's own reminders whose time has come (set through the assistant).
  for (const r of dueReminders(await readReminders())) out.push({ key: `remind:${r.id}`, okla: r.okla ?? "", building: "", title: `Reminder: ${r.text}` });
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

// ---- when the automation can't finish a step for one elevator ----
// The Make automation skips that elevator (every other one keeps going) and
// calls /api/push/problem, which lands here. Each problem buzzes the phone once a
// day — Make retries every hour, and it shouldn't buzz every hour.

// Make's error text, said the way a person would.
function plainReason(error: string): string {
  const e = error.toLowerCase();
  if (e.startsWith("there's ")) return error; // already said plainly by the app
  if (e.includes("invalid_grant")) return "the QuickBooks connection needs signing in again";
  if (e.includes("not a valid date")) return "a date on it isn't a real date";
  if (e.includes("email") || e.includes("recipient") || e.includes("invalid to")) return "the email address doesn't look right";
  if (e.includes("quota") || e.includes("rate limit") || e.includes("429")) return "Google was busy — it will try again";
  if (e.includes("timeout") || e.includes("timed out") || e.includes("econn")) return "a connection timed out — it will try again";
  return error.length > 140 ? error.slice(0, 140) + "…" : error || "an unknown error";
}

const PROBLEMS = "problemsSent";
export async function sendProblemAlert(okla: string, building: string, step: string, error: string): Promise<{ sent: number; repeat: boolean }> {
  const key = `${okla}:${step}`;
  let seen: { day?: number; keys?: string[] } = {};
  try {
    seen = JSON.parse((await readConfig()).get(PROBLEMS) || "{}");
  } catch {
    /* start fresh */
  }
  const today = todayNum();
  const keys = seen.day === today ? (seen.keys ?? []) : [];
  if (keys.includes(key)) return { sent: 0, repeat: true };
  await writeConfig(PROBLEMS, JSON.stringify({ day: today, keys: [...keys, key] }));
  const name = building || `OK# ${okla}`;
  const { sent } = await sendAlert(
    `Problem: ${name}`,
    `${step[0].toUpperCase()}${step.slice(1)} didn't go through — ${plainReason(error)}.`,
    okla ? `/?open=${encodeURIComponent(okla)}` : "/",
    `eei-problem-${key}`,
  );
  return { sent, repeat: false };
}

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
      // urgency "high": deliver now even if the phone is idle (Android holds
      // normal-priority messages until the phone wakes). TTL: give up after 12 hours.
      await webpush.sendNotification(sub, payload, { urgency: "high", TTL: 12 * 60 * 60 });
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await dropSubscription(row);
        pruned++;
      } else {
        // Anything else is logged, never swallowed silently.
        console.error(`[alerts] couldn't reach a phone (row ${row}): status ${status ?? "?"} ${err instanceof Error ? err.message : ""}`);
      }
    }
  }
  return { sent, pruned };
}
