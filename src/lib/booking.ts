import { readRows, cell, COL, FIRST_ROW, TAB, letter, type Col } from "@/lib/sheet";
import { writeCells } from "@/lib/google";
import { OK_TZ, calendlyConfigured, invitees, listEvents, me } from "@/lib/calendly";

// CALENDLY BOOKINGS (Robert, 2026-10-14). A customer picks a day on Calendly →
// the visit is booked: Visit = Booked, Trip day = that day. No one is asked —
// Robert marks the days he can't do as busy in his Google Calendar (Calendly
// won't offer them), and anything else is a phone call to reschedule.
// A customer who cancels (or reschedules) in Calendly undoes the booking, and
// Robert's phone is told.
//
// Sheet: BR bookedAt = the booked time (ISO UTC), BS bookingEvent = the Calendly
// event (so a cancellation can be matched back to the elevator).

const clock = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { timeZone: OK_TZ, ...opts });
// "10/21/2026" (Oklahoma date) — the dashboard's Trip day format.
const tripDate = (iso: string) => clock(iso, { month: "numeric", day: "numeric", year: "numeric" });

type Row = string[];

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

// Every hour (from /api/push/run) and when Settings opens (/api/calendly), while
// the master switch is on: book new Calendly bookings onto their elevators, and
// undo ones the customer cancelled. `cancelled` = buildings whose booked visit
// the customer cancelled (Robert's phone is told).
export async function syncBookings(): Promise<{ booked: string[]; cancelled: string[] }> {
  const out = { booked: [] as string[], cancelled: [] as string[] };
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
      out.cancelled.push(cell(r, "building"));
    }
    set(i, "bookedAt", "");
    set(i, "bookingEvent", "");
    r[COL.bookingEvent] = ""; // so a rescheduled booking below can land on it
    if (cell(r, "visit") === "Booked") r[COL.visit] = "";
  });

  // New bookings → booked.
  const known = new Set(rows.map((r) => cell(r, "bookingEvent")).filter(Boolean));
  for (const ev of active) {
    if (known.has(ev.uri)) continue;
    const people = (await invitees(ev))
      .filter((p) => p.status === "active")
      .map((p) => ({ email: p.email ?? "", code: p.tracking?.utm_content ?? "" }));
    for (const i of matchRows(rows, people)) {
      set(i, "visit", "Booked");
      set(i, "tripDay", tripDate(ev.start_time));
      set(i, "bookedAt", ev.start_time.replace(/\.\d+Z$/, "Z"));
      set(i, "bookingEvent", ev.uri);
      rows[i][COL.bookingEvent] = ev.uri;
      rows[i][COL.visit] = "Booked";
      out.booked.push(cell(rows[i], "okla"));
    }
  }
  // Dates as dates (Trip day), everything else exactly as written.
  const tripCol = `${TAB}!${letter(COL.tripDay)}`;
  const dates = writes.filter(([a]) => a.startsWith(tripCol) && /\d$/.test(a.slice(tripCol.length)));
  const rest = writes.filter((w) => !dates.includes(w));
  if (rest.length) await writeCells(rest, true);
  if (dates.length) await writeCells(dates);
  return out;
}
