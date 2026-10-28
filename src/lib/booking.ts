import { readRows, cell, COL, FIRST_ROW, TAB, letter, schedSentTime, type Col } from "@/lib/sheet";
import { appendRow, readRange, writeCells } from "@/lib/google";
import { OK_TZ, calendlyConfigured, invitees, listEvents, me } from "@/lib/calendly";

// CALENDLY BOOKINGS (Robert, 2026-10-14/15). A customer picks a day on Calendly →
// the visit is booked: Visit = Booked, Trip day = that day. No one is asked —
// Robert marks the days he can't do as busy in his Google Calendar (Calendly
// won't offer them), and anything else is a phone call to reschedule.
// A customer who cancels (or reschedules) in Calendly undoes the booking, and
// Robert's phone is told.
//
// AIRTIGHT (no phantom bookings, whatever is clicked or edited): a Calendly
// booking books an elevator ONLY if all of these hold —
//   1. it has never been used before: every booking the app books onto an
//      elevator goes on the "Calendly used" tab, which nothing in the app or the
//      automation ever clears;
//   2. that elevator's scheduling email went out THIS cycle (Scheduling = Sent,
//      with its "sent at" time in col BT) and its visit isn't already booked or
//      inspected — a reset elevator has none, so nothing can land on it;
//   3. the booking was made AFTER that scheduling email went out.
//
// Sheet: BR bookedAt = the booked time (ISO UTC), BS bookingEvent = the Calendly
// event (so a cancellation can be matched back to the elevator).

export const USED_TAB = "Calendly used"; // A event | B used on (ISO) | C OK # | D building | E booked day

const clock = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { timeZone: OK_TZ, ...opts });
// "10/21/2026" (Oklahoma date) — the dashboard's Trip day format.
const tripDate = (iso: string) => clock(iso, { month: "numeric", day: "numeric", year: "numeric" });

type Row = string[];

// Rule 2 (+ rule 3 for a booking made at `madeAt`): can this elevator take a booking?
function canBook(r: Row, madeAt: number): boolean {
  if (!cell(r, "okla") || cell(r, "scheduling") !== "Sent") return false;
  const v = cell(r, "visit");
  if (v === "Booked" || v === "Inspected") return false;
  const sent = schedSentTime(cell(r, "schedSentAt"));
  return sent !== null && madeAt >= sent;
}

// Which elevators a Calendly booking belongs to. The link in the scheduling
// email carries the elevator's link code (utm_content); a booking without it
// matches by the customer's email instead. Other elevators of the same customer
// at the same building go along (one visit) — each must pass the same rules.
function matchRows(rows: Row[], people: { email: string; code: string }[], madeAt: number): number[] {
  const ok = (r: Row) => canBook(r, madeAt);
  let hit = rows.findIndex((r) => ok(r) && people.some((p) => p.code && p.code === cell(r, "token")));
  if (hit === -1) {
    const emails = new Set(people.map((p) => p.email.toLowerCase()).filter(Boolean));
    hit = rows.findIndex((r) => ok(r) && emails.has(cell(r, "email").toLowerCase()));
  }
  if (hit === -1) return [];
  const h = rows[hit];
  const same = (r: Row) => ok(r) && cell(r, "email").toLowerCase() === cell(h, "email").toLowerCase() && cell(r, "building") === cell(h, "building");
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
  const used = new Set((await readRange(`'${USED_TAB}'!A2:A`)).map((r) => (r[0] ?? "").trim()).filter(Boolean));
  const writes: [string, string][] = [];
  const set = (i: number, c: Col, v: string) => writes.push([`${TAB}!${letter(COL[c])}${FIRST_ROW + i}`, v]);

  // Cancelled by the customer (or rescheduled — Calendly cancels the old one).
  // This only ever UN-books, never books.
  const gone = new Set(canceled.map((e) => e.uri));
  rows.forEach((r, i) => {
    const ev = cell(r, "bookingEvent");
    if (!ev || !gone.has(ev)) return;
    if (cell(r, "visit") === "Booked") {
      set(i, "visit", "");
      set(i, "tripDay", "");
      // The access reminder was for the cancelled day: clear it (and any fast
      // track of it) so a new booking gets its own reminder (Robert, 2026-10-28).
      set(i, "accessReminder", "");
      set(i, "ftAccess", "");
      out.cancelled.push(cell(r, "building"));
      r[COL.visit] = "";
    }
    set(i, "bookedAt", "");
    set(i, "bookingEvent", "");
    r[COL.bookingEvent] = "";
  });

  // New bookings → booked (only when all three rules hold).
  const newlyUsed: string[][] = [];
  for (const ev of active) {
    if (used.has(ev.uri)) continue; // rule 1
    const madeAt = Date.parse(ev.created_at);
    if (Number.isNaN(madeAt)) continue;
    const people = (await invitees(ev))
      .filter((p) => p.status === "active")
      .map((p) => ({ email: p.email ?? "", code: p.tracking?.utm_content ?? "" }));
    const hits = matchRows(rows, people, madeAt);
    if (!hits.length) continue;
    used.add(ev.uri);
    for (const i of hits) {
      set(i, "visit", "Booked");
      set(i, "tripDay", tripDate(ev.start_time));
      set(i, "bookedAt", ev.start_time.replace(/\.\d+Z$/, "Z"));
      set(i, "bookingEvent", ev.uri);
      rows[i][COL.bookingEvent] = ev.uri;
      rows[i][COL.visit] = "Booked";
      out.booked.push(cell(rows[i], "okla"));
      newlyUsed.push([ev.uri, new Date().toISOString(), cell(rows[i], "okla"), cell(rows[i], "building"), tripDate(ev.start_time)]);
    }
  }
  // Mark the bookings used FIRST: if anything after this fails, the worst case
  // is a booking that didn't land (fixed by hand) — never one that lands twice.
  for (const u of newlyUsed) await appendRow(`'${USED_TAB}'!A:E`, u);
  // Dates as dates (Trip day), everything else exactly as written.
  const tripCol = `${TAB}!${letter(COL.tripDay)}`;
  const dates = writes.filter(([a]) => a.startsWith(tripCol) && /^\d+$/.test(a.slice(tripCol.length)));
  const rest = writes.filter((w) => !dates.includes(w));
  if (rest.length) await writeCells(rest, true);
  if (dates.length) await writeCells(dates);
  return out;
}
