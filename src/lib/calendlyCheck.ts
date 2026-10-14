import {
  OK_TZ,
  availableTimes,
  bookingEventType,
  busyTimes,
  calendlyConfigured,
  getAvailability,
  me,
  setAvailability,
  updateEventType,
  type CalAvailability,
  type CalEventType,
  type CalRule,
} from "@/lib/calendly";

// Settings → Calendly: is the booking page actually offering times, and if not,
// why — in plain words — plus the fix the app can make (with Robert's OK).

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SHORT: Record<string, string> = { sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat" };
const ampm = (t: string) => {
  const h = +t.slice(0, 2);
  const m = t.slice(3, 5);
  return `${h % 12 || 12}${m === "00" ? "" : ":" + m}${h < 12 ? "am" : "pm"}`;
};
const zoneName = (tz: string) => (tz === OK_TZ ? "Oklahoma (Central)" : tz === "America/New_York" ? "New York (Eastern)" : tz);

// Weekday hours used when Calendly has none at all (shown to Robert before he says yes).
export const DEFAULT_HOURS = { days: ["monday", "tuesday", "wednesday", "thursday", "friday"], from: "08:00", to: "17:00" };

export type CalendlyCheck = {
  connected: boolean;
  error?: string;
  link?: string;
  eventName?: string;
  active?: boolean;
  accountZone?: string;
  hoursZone?: string;
  weekly?: string[]; // "Mon 9am–5pm"
  openTimes?: number; // open start times in the next 4 weeks
  openDays?: number; // days with at least one open time
  firstOpen?: string;
  busyDays?: number; // of the next 7 days, how many are busy all day on his calendar
  problems: string[];
  fixes: string[]; // what "Fix Calendly" would change
};

function weekly(a: CalAvailability): string[] {
  return DAYS.flatMap((d) => {
    const r = a.rules.find((x) => x.type === "wday" && x.wday === d);
    return r && r.intervals.length ? [`${SHORT[d]} ${r.intervals.map((i) => `${ampm(i.from)}–${ampm(i.to)}`).join(", ")}`] : [];
  });
}

// What the fix would do to the rules: weekly hours if there are none, and the
// time zone moved to Oklahoma (same clock hours — 9–5 stays 9–5, Oklahoma time).
function fixedRules(a: CalAvailability): { timezone: string; rules: CalRule[]; fixes: string[] } {
  const fixes: string[] = [];
  let rules = a.rules;
  if (!weekly(a).length) {
    rules = [
      ...rules.filter((r) => r.type !== "wday"),
      ...DAYS.map((d): CalRule => ({ type: "wday", wday: d, intervals: DEFAULT_HOURS.days.includes(d) ? [{ from: DEFAULT_HOURS.from, to: DEFAULT_HOURS.to }] : [] })),
    ];
    fixes.push(`Open Monday–Friday, ${ampm(DEFAULT_HOURS.from)}–${ampm(DEFAULT_HOURS.to)} (change them in Calendly any time)`);
  }
  if (a.timezone !== OK_TZ) fixes.push(`Use Oklahoma time for the hours (now ${zoneName(a.timezone)})`);
  return { timezone: OK_TZ, rules, fixes };
}

// The booking page itself (Robert, 2026-10-14): customers book a whole DAY, not
// an hour — so each booking lasts the full working day (one choice per day);
// it's called "Elevator inspection" and happens on site, not on Google Meet.
export const BOOKING_NAME = "Elevator inspection";
const ON_SITE = "On site at the elevator's building";
const DESCRIPTION = "Pick the day for your elevator's state inspection. The inspector comes on site during the day.";
const span = (i: { from: string; to: string }) => +i.to.slice(0, 2) * 60 + +i.to.slice(3, 5) - (+i.from.slice(0, 2) * 60 + +i.from.slice(3, 5));
function fixedEvent(et: CalEventType, a: { rules: CalRule[] }) {
  // The longest working day in the weekly hours (Calendly allows up to 12 hours).
  const day = Math.min(720, Math.max(0, ...a.rules.filter((r) => r.type === "wday").flatMap((r) => r.intervals.map(span))));
  const changes: { name?: string; duration?: number; description?: string; locations?: { kind: string; location: string }[] } = {};
  const fixes: string[] = [];
  const problems: string[] = [];
  if (day && et.duration !== day) {
    changes.duration = day;
    problems.push(`Customers pick a ${et.duration}-minute time slot, not a whole day.`);
    fixes.push(`Book whole days: each booking takes the full working day (${day / 60} hours), so customers pick a day, not a time`);
  }
  if (et.name !== BOOKING_NAME) {
    changes.name = BOOKING_NAME;
    problems.push(`The booking page is called "${et.name}".`);
    fixes.push(`Name it "${BOOKING_NAME}" (now "${et.name}")`);
  }
  const locs = et.locations ?? [];
  if (!(locs.length === 1 && locs[0].kind === "custom" && locs[0].location === ON_SITE)) {
    changes.locations = [{ kind: "custom", location: ON_SITE }];
    if (!et.description_plain) changes.description = DESCRIPTION;
    const was = locs.map((l) => (l.kind === "google_conference" ? "Google Meet" : l.location || l.kind)).join(", ") || "none";
    problems.push(`The location is ${was}, not on site.`);
    fixes.push(`Location: on site (now ${was})`);
  }
  return { changes, fixes, problems };
}

export async function checkCalendly(): Promise<CalendlyCheck> {
  if (!calendlyConfigured()) return { connected: false, problems: ["Calendly isn't connected to the app yet (no CALENDLY_TOKEN in Vercel)."], fixes: [] };
  try {
    const user = await me();
    const et = await bookingEventType(user);
    const a = await getAvailability(et);
    const now = new Date(Date.now() + 5 * 60_000);
    const open = await availableTimes(et, now, new Date(now.getTime() + 28 * 86_400_000));
    const busy = await busyTimes(user, now, new Date(now.getTime() + 7 * 86_400_000)).catch(() => []);
    // A day counts as "busy all day" when one busy block covers 8am–5pm Oklahoma time.
    const busyDays = new Set(
      busy
        .filter((b) => new Date(b.end_time).getTime() - new Date(b.start_time).getTime() >= 9 * 3_600_000)
        .map((b) => new Date(b.start_time).toLocaleDateString("en-CA", { timeZone: OK_TZ })),
    ).size;

    const problems: string[] = [];
    const w = weekly(a);
    if (!et.active) problems.push(`The "${et.name}" booking page is turned off in Calendly.`);
    if (!w.length) problems.push("No weekly hours are set, so Calendly has nothing to offer.");
    if (a.timezone !== OK_TZ) problems.push(`The hours are set in ${zoneName(a.timezone)} time, not Oklahoma time.`);
    if (user.timezone !== OK_TZ) problems.push(`Your Calendly account's time zone is ${zoneName(user.timezone)} (change it in Calendly → Profile → Time zone).`);
    if (!open.length && w.length && busyDays >= 5) problems.push("Your Google Calendar shows you busy all day on most days, and Calendly treats busy as taken.");
    if (!open.length && !problems.length) problems.push("No open times in the next 4 weeks, and the cause isn't visible from here — open Calendly → Availability.");
    const ev = fixedEvent(et, fixedRules(a));
    problems.push(...ev.problems);
    const fixes = [...fixedRules(a).fixes, ...ev.fixes];
    return {
      connected: true,
      link: et.scheduling_url,
      eventName: et.name,
      active: et.active,
      accountZone: zoneName(user.timezone),
      hoursZone: zoneName(a.timezone),
      weekly: w,
      openTimes: open.length,
      openDays: new Set(open.map((t) => new Date(t).toLocaleDateString("en-CA", { timeZone: OK_TZ }))).size,
      firstOpen: open[0],
      busyDays,
      problems,
      fixes,
    };
  } catch (err) {
    return { connected: false, error: err instanceof Error ? err.message : "Calendly check failed", problems: [], fixes: [] };
  }
}

// "Fix Calendly" (after Robert's "Are you sure?").
export async function fixCalendly(): Promise<string[]> {
  const user = await me();
  const et = await bookingEventType(user);
  const a = await getAvailability(et);
  const f = fixedRules(a);
  if (f.fixes.length) await setAvailability(et, { timezone: f.timezone, rules: f.rules });
  const ev = fixedEvent(et, f);
  if (ev.fixes.length) await updateEventType(et, ev.changes);
  return [...f.fixes, ...ev.fixes];
}
