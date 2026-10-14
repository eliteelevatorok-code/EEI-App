import {
  OK_TZ,
  availableTimes,
  bookingEventType,
  busyTimes,
  calendlyConfigured,
  getAvailability,
  me,
  setAvailability,
  type CalAvailability,
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
    const { fixes } = fixedRules(a);
    return {
      connected: true,
      link: et.scheduling_url,
      eventName: et.name,
      active: et.active,
      accountZone: zoneName(user.timezone),
      hoursZone: zoneName(a.timezone),
      weekly: w,
      openTimes: open.length,
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
  if (!f.fixes.length) return [];
  await setAvailability(et, { timezone: f.timezone, rules: f.rules });
  return f.fixes;
}
