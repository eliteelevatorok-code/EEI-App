import { readRows, cell, COL, FIRST_ROW, TAB, letter, type Col, requireElevatorRow, readRow } from "@/lib/sheet";
import { writeCells } from "@/lib/google";
import {

  CalendlyError,
  OK_TZ,
  bookingEventType,
  calendlyConfigured,
  cancelEvent,
  getAvailability,
  invitees,
  listEvents,
  me,
  setAvailability,
  type CalRule,
} from "@/lib/calendly";

// BOOKING CONFIRM (Robert, 2026-10-13). A customer books a time on Calendly →
// Robert is asked on his phone whether it works:
//   Yes              → Visit = Booked + Trip day (the access reminder can go).
//   Pick other days  → that Calendly booking is cancelled, Calendly is changed to
//                      offer only the days he picked, and the customer gets an
//                      email (Make "Pick a new time") listing them.
// Nothing after the scheduling email moves until he says Yes.
//
// Sheet: BR bookedAt = the picked time (ISO UTC; kept after Yes so the time
// shows), BS bookingEvent = the Calendly event, BT newDays = text for the
// "pick a new time" email (Make sends it, then clears it). Waiting for Robert =
// BR set and Visit not Booked.

const clock = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { timeZone: OK_TZ, ...opts });
// "Tue, Oct 21, 9:00 AM" (Oklahoma time).
export const pickedText = (iso: string) => clock(iso, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
// "10/21/2026" (Oklahoma date) — the dashboard's Trip day format.
const tripDate = (iso: string) => clock(iso, { month: "numeric", day: "numeric", year: "numeric" });

type Row = string[];
const isWaiting = (r: Row) => !!cell(r, "bookedAt") && cell(r, "visit") !== "Booked" && cell(r, "visit") !== "Inspected";

// Which elevators a Calendly booking belongs to. The link in the scheduling
// email carries the elevator's link code (utm_content); a booking without it
// (e.g. made from an older email) matches by the customer's email instead —
// only elevators that were sent the scheduling email and aren't booked yet.
// Other elevators of the same customer at the same building go along (one visit).
function matchRows(rows: Row[], people: { email: string; code: string }[]): number[] {
  const live = (r: Row) => !!cell(r, "okla") && cell(r, "visit") !== "Inspected";
  let hit = rows.findIndex((r) => live(r) && people.some((p) => p.code && p.code === cell(r, "token")));
  if (hit === -1) {
    const emails = new Set(people.map((p) => p.email.toLowerCase()).filter(Boolean));
    hit = rows.findIndex(
      (r) => live(r) && emails.has(cell(r, "email").toLowerCase()) && cell(r, "scheduling") === "Sent" && cell(r, "visit") !== "Booked",
    );
  }
  if (hit === -1) return [];
  const h = rows[hit];
  const same = (r: Row) =>
    live(r) && cell(r, "visit") !== "Booked" && cell(r, "email").toLowerCase() === cell(h, "email").toLowerCase() && cell(r, "building") === cell(h, "building");
  return rows.map((r, i) => (i === hit || same(r) ? i : -1)).filter((i) => i !== -1);
}

// Every hour (from /api/push/run, while the master switch is on): record new
// Calendly bookings on their elevators, and undo ones the customer cancelled.
// Returns what changed, plus the buildings whose CONFIRMED visit was cancelled
// by the customer (so Robert is told).
export async function syncBookings(): Promise<{ added: string[]; dropped: string[]; cancelledConfirmed: string[] }> {
  const out = { added: [] as string[], dropped: [] as string[], cancelledConfirmed: [] as string[] };
  if (!calendlyConfigured()) return out;
  const user = await me();
  const since = new Date(Date.now() - 60 * 60_000); // a booking for the next hour still counts
  const [active, canceled] = await Promise.all([listEvents(user, "active", since), listEvents(user, "canceled", since)]);
  const rows = await readRows();
  const writes: [string, string][] = [];
  const set = (i: number, c: Col, v: string) => writes.push([`${TAB}!${letter(COL[c])}${FIRST_ROW + i}`, v]);

  // Cancelled by the customer (or rescheduled — Calendly cancels the old one).
  const gone = new Set(canceled.map((e) => e.uri));
  rows.forEach((r, i) => {
    const ev = cell(r, "bookingEvent");
    if (!ev || !gone.has(ev)) return;
    if (cell(r, "visit") === "Booked") {
      set(i, "visit", "");
      set(i, "tripDay", "");
      out.cancelledConfirmed.push(cell(r, "building"));
    }
    set(i, "bookedAt", "");
    set(i, "bookingEvent", "");
    out.dropped.push(cell(r, "okla"));
    r[COL.bookingEvent] = ""; // so a rescheduled booking below can land on it
    r[COL.visit] = cell(r, "visit") === "Booked" ? "" : r[COL.visit];
  });

  // New bookings.
  const known = new Set(rows.map((r) => cell(r, "bookingEvent")).filter(Boolean));
  for (const ev of active) {
    if (known.has(ev.uri)) continue;
    const people = (await invitees(ev))
      .filter((p) => p.status === "active")
      .map((p) => ({ email: p.email ?? "", code: p.tracking?.utm_content ?? "" }));
    for (const i of matchRows(rows, people)) {
      set(i, "bookedAt", ev.start_time.replace(/\.\d+Z$/, "Z"));
      set(i, "bookingEvent", ev.uri);
      rows[i][COL.bookingEvent] = ev.uri;
      out.added.push(cell(rows[i], "okla"));
    }
  }
  if (writes.length) await writeCells(writes, true);
  return out;
}

// The rows that share this elevator's booking (one visit, several elevators).
async function bookingRows(row: number, okla: string) {
  const at = await requireElevatorRow(row, okla);
  const me_ = await readRow(at);
  const ev = cell(me_, "bookingEvent");
  if (!ev) throw new BookingError("There's no Calendly booking on this elevator.");
  const rows = await readRows();
  const idx = rows.map((r, i) => (cell(r, "bookingEvent") === ev ? i : -1)).filter((i) => i !== -1);
  return { ev, mine: me_, rows, idx };
}
export class BookingError extends Error {}

// Robert: "Yes, that works."
export async function confirmBooking(row: number, okla: string): Promise<{ tripDay: string; at: string }> {
  const { mine, rows, idx } = await bookingRows(row, okla);
  if (!isWaiting(mine)) throw new BookingError("This booking isn't waiting for an answer any more.");
  const at = cell(mine, "bookedAt");
  const tripDay = tripDate(at);
  const writes: [string, string][] = [];
  for (const i of idx) {
    if (!isWaiting(rows[i])) continue;
    writes.push([`${TAB}!${letter(COL.visit)}${FIRST_ROW + i}`, "Booked"], [`${TAB}!${letter(COL.tripDay)}${FIRST_ROW + i}`, tripDay]);
  }
  await writeCells(writes);
  return { tripDay, at };
}

// "10:30" → minutes; and back.
const mins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
// How many minutes `tz` is ahead of Oklahoma on a given day (e.g. New York: +60).
function aheadOfOklahoma(tz: string, date: string): number {
  const noon = new Date(`${date}T18:00:00Z`);
  const at = (z: string) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: z, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(noon);
    return +p.find((x) => x.type === "hour")!.value * 60 + +p.find((x) => x.type === "minute")!.value;
  };
  return at(tz) - at(OK_TZ);
}
const okToday = () => new Date().toLocaleDateString("en-CA", { timeZone: OK_TZ }); // yyyy-mm-dd
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
const ampm = (t: string) => {
  const m = mins(t);
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

// Robert: "Pick other days." `days` are yyyy-mm-dd (Oklahoma), `from`/`to` the
// hours on those days ("08:00"–"17:00", Oklahoma time). On Calendly, from
// tomorrow through the last picked day, ONLY the picked days stay open (for
// every customer — it's Robert's real availability); days after that are left
// alone. Then the customer's booking is cancelled and the email is queued.
export async function pickOtherDays(row: number, okla: string, days: string[], from: string, to: string): Promise<{ newDays: string }> {
  const today = okToday();
  const picked = [...new Set(days)].sort();
  if (!picked.length) throw new BookingError("Pick at least one day.");
  if (picked.length > 31) throw new BookingError("Pick 31 days or fewer.");
  if (picked.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d) || d <= today || d > addDays(today, 90)))
    throw new BookingError("Pick days between tomorrow and 90 days from now.");
  if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to) || mins(from) >= mins(to)) throw new BookingError("Pick hours where the start is before the end.");

  const { ev, rows, idx } = await bookingRows(row, okla);

  // 1. Calendly shows only the picked days (tomorrow → last picked day).
  const user = await me();
  const et = await bookingEventType(user);
  const avail = await getAvailability(et);
  const last = picked[picked.length - 1];
  const window = new Set<string>();
  for (let d = addDays(today, 1); d <= last; d = addDays(d, 1)) window.add(d);
  const keep = avail.rules.filter((r) => !(r.type === "date" && r.date && window.has(r.date)));
  const add: CalRule[] = [...window].map((d) => {
    if (!picked.includes(d)) return { type: "date", date: d, intervals: [] };
    const shift = aheadOfOklahoma(avail.timezone, d); // Calendly's hours may be kept in another time zone
    return { type: "date", date: d, intervals: [{ from: hhmm(mins(from) + shift), to: hhmm(mins(to) + shift) }] };
  });
  await setAvailability(et, { timezone: avail.timezone, rules: [...keep, ...add] });

  // 2. Cancel the customer's booking (Calendly emails them the reason).
  try {
    await cancelEvent(ev, "Robert isn't available at that time. You'll get an email with the days that work so you can pick again.");
  } catch (err) {
    // Already cancelled is fine; anything else stops here (Calendly is already changed — say so).
    if (!(err instanceof CalendlyError && (err.status === 403 || err.status === 404 || /cancel/i.test(err.message))))
      throw new BookingError(`Calendly's days were changed, but the booking couldn't be cancelled: ${(err as Error).message}`);
  }

  // 3. Clear the booking on the dashboard and queue the "pick a new time" email.
  const newDays = `${picked.map(longDay).join("; ")} (between ${ampm(from)} and ${ampm(to)}, Oklahoma time)`;
  const writes: [string, string][] = [];
  const set = (i: number, c: Col, v: string) => writes.push([`${TAB}!${letter(COL[c])}${FIRST_ROW + i}`, v]);
  for (const i of idx) {
    const r = rows[i];
    if (cell(r, "visit") === "Booked") {
      set(i, "visit", "");
      set(i, "tripDay", "");
    }
    set(i, "bookedAt", "");
    set(i, "bookingEvent", "");
  }
  set(idx[0], "newDays", newDays); // one email per customer, not one per elevator
  await writeCells(writes, true);
  return { newDays };
}


