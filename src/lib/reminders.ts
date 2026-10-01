import { readConfig, writeConfig } from "@/lib/config";

// Robert's own reminders ("remind me tomorrow to call Edmond"), set through the
// assistant. Kept in the Config tab (row "reminders") as a short list. The hourly
// alert run (/api/push/run) buzzes the phone with each one on its day — after its
// hour, if one was given — and then drops it. Like every alert, they wait while
// the master switch is off.
export type Reminder = {
  id: string;
  day: number; // yyyymmdd, Oklahoma
  hour?: number; // 0–23, Oklahoma; none = first alert run that day (7am)
  text: string;
  okla?: string; // the elevator it's about, if any (tapping the alert opens it)
};

const KEY = "reminders";
const MAX = 50;

// Today (yyyymmdd) and the hour, in Oklahoma.
export function okNow(): { day: number; hour: number } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { day: get("year") * 10000 + get("month") * 100 + get("day"), hour: get("hour") };
}

// yyyymmdd → "Thu, Oct 1" (+ " at 3pm").
export function whenText(r: Pick<Reminder, "day" | "hour">): string {
  const d = new Date(Math.floor(r.day / 10000), (Math.floor(r.day / 100) % 100) - 1, r.day % 100);
  const date = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (r.hour === undefined) return date;
  const h = r.hour % 12 || 12;
  return `${date} at ${h}${r.hour < 12 ? "am" : "pm"}`;
}

export async function readReminders(): Promise<Reminder[]> {
  try {
    const v = JSON.parse((await readConfig()).get(KEY) || "[]");
    return Array.isArray(v) ? (v as Reminder[]) : [];
  } catch {
    return [];
  }
}

async function save(list: Reminder[]): Promise<void> {
  await writeConfig(KEY, JSON.stringify(list));
}

// "10/1/2026" → 20261001, only for a real calendar date (0 otherwise).
export function dayOf(date: string): number {
  const m = String(date).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return 0;
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  if (d.getUTCFullYear() !== +m[3] || d.getUTCMonth() !== +m[1] - 1 || d.getUTCDate() !== +m[2]) return 0;
  return +m[3] * 10000 + +m[1] * 100 + +m[2];
}

export async function addReminder(input: { date: string; hour?: number; text: string; okla?: string }): Promise<Reminder> {
  const day = dayOf(input.date);
  if (!day) throw new Error("That reminder needs a real date (M/D/YYYY).");
  const now = okNow();
  if (day < now.day) throw new Error("That date has already passed.");
  const text = String(input.text ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!text) throw new Error("What should the reminder say?");
  const hour = input.hour === undefined || input.hour === null ? undefined : Math.trunc(Number(input.hour));
  if (hour !== undefined && !(hour >= 0 && hour <= 23)) throw new Error("The hour must be 0–23.");
  const list = (await readReminders()).filter((r) => r.day >= now.day); // old ones drop off
  if (list.length >= MAX) throw new Error(`There are already ${MAX} reminders waiting — cancel some first.`);
  const r: Reminder = { id: Math.random().toString(36).slice(2, 8), day, text, ...(hour !== undefined ? { hour } : {}), ...(input.okla ? { okla: String(input.okla).slice(0, 40) } : {}) };
  await save([...list, r].sort((a, b) => a.day - b.day || (a.hour ?? 0) - (b.hour ?? 0)));
  return r;
}

export async function cancelReminder(id: string): Promise<Reminder | null> {
  const list = await readReminders();
  const hit = list.find((r) => r.id === id) ?? null;
  if (hit) await save(list.filter((r) => r.id !== id));
  return hit;
}

// The reminders whose time has come (today after their hour, or a missed earlier day).
export function dueReminders(list: Reminder[]): Reminder[] {
  const now = okNow();
  return list.filter((r) => r.day < now.day || (r.day === now.day && (r.hour === undefined || now.hour >= r.hour)));
}

// After an alert run announced them: drop them so they don't buzz again tomorrow.
export async function dropReminders(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const list = await readReminders();
  const left = list.filter((r) => !ids.includes(r.id));
  if (left.length !== list.length) await save(left);
}
