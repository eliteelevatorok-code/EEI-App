// Calendly — the booking page in the scheduling email. Robert kept Calendly
// (it syncs with his Google Calendar); the app only talks to it to:
//   • see new bookings (checked every hour — webhooks need a paid plan, the
//     API itself works on the free plan),
//   • cancel a booking Robert says doesn't work,
//   • open only the days Robert picks instead,
//   • show what's wrong when the page has no open times (Settings).
//
// Signs in with a Calendly personal access token that Robert made himself and
// put in Vercel as CALENDLY_TOKEN (Calendly → Integrations → API & Webhooks).
// Scopes: users:read, event_types:read, scheduled_events:read/write,
// availability:read/write. Docs: https://developer.calendly.com

const BASE = "https://api.calendly.com";

// The booking link in the scheduling email (Make #7) ends in this event slug.
export const BOOKING_SLUG = "30min";
// Oklahoma.
export const OK_TZ = "America/Chicago";

export const calendlyConfigured = () => !!process.env.CALENDLY_TOKEN?.trim();

export class CalendlyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function cal<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = process.env.CALENDLY_TOKEN?.trim();
  if (!token) throw new CalendlyError("Calendly isn't connected yet (CALENDLY_TOKEN is missing).", 0);
  const res = await fetch(path.startsWith("http") ? path : BASE + path, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { title?: string; message?: string; details?: { message?: string }[] };
      msg = [j.title, j.message, ...(j.details ?? []).map((d) => d.message)].filter(Boolean).join(" — ");
    } catch {
      /* keep raw text */
    }
    throw new CalendlyError(`Calendly said ${res.status}: ${msg}`, res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// Walk every page of a list endpoint.
async function all<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = path;
  for (let i = 0; next && i < 20; i++) {
    const page: { collection: T[]; pagination?: { next_page?: string | null } } = await cal(next);
    out.push(...page.collection);
    next = page.pagination?.next_page ?? null;
  }
  return out;
}

export type CalUser = { uri: string; name: string; timezone: string; scheduling_url: string };
export const me = async () => (await cal<{ resource: CalUser }>("/users/me")).resource;

export type CalLocation = { kind: string; location?: string };
export type CalEventType = {
  uri: string;
  name: string;
  slug: string;
  active: boolean;
  scheduling_url: string;
  duration: number;
  description_plain?: string | null;
  locations?: CalLocation[] | null;
};
// Rename / re-time / re-locate the booking event type (needs event_types:write).
export async function updateEventType(
  eventType: CalEventType,
  changes: { name?: string; duration?: number; description?: string; locations?: CalLocation[] },
): Promise<void> {
  await cal(eventType.uri, { method: "PATCH", body: changes });
}
// The event type the scheduling email links to.
export async function bookingEventType(user: CalUser): Promise<CalEventType> {
  const types = await all<CalEventType>(`/event_types?user=${encodeURIComponent(user.uri)}&count=100`);
  const t = types.find((x) => x.slug === BOOKING_SLUG) ?? types.find((x) => x.active);
  if (!t) throw new CalendlyError("Calendly has no event type to book.", 404);
  return t;
}

export type CalEvent = { uri: string; name: string; status: "active" | "canceled"; start_time: string; end_time: string; event_type: string };
export function listEvents(user: CalUser, status: "active" | "canceled", minStart: Date): Promise<CalEvent[]> {
  const q = new URLSearchParams({ user: user.uri, status, min_start_time: minStart.toISOString(), sort: "start_time:asc", count: "100" });
  return all<CalEvent>(`/scheduled_events?${q}`);
}

export type CalInvitee = { email: string; name: string; status: string; tracking?: { utm_content?: string | null } };
export const invitees = (event: CalEvent) => all<CalInvitee>(`${event.uri}/invitees?count=100`);

export async function cancelEvent(eventUri: string, reason: string): Promise<void> {
  await cal(`${eventUri}/cancellation`, { method: "POST", body: { reason } });
}

// Availability of the booking event type. Rules: weekly ("wday") and one-off
// ("date", overrides that day); an empty `intervals` list = closed that day.
export type CalInterval = { from: string; to: string };
export type CalRule = { type: "wday" | "date"; wday?: string; date?: string; intervals: CalInterval[] };
export type CalAvailability = { timezone: string; rules: CalRule[]; name?: string };
export async function getAvailability(eventType: CalEventType): Promise<CalAvailability> {
  const r = await cal<{ collection: { availability_rule?: CalAvailability }[] }>(
    `/event_type_availability_schedules?event_type=${encodeURIComponent(eventType.uri)}`,
  );
  const rule = r.collection[0]?.availability_rule;
  return { timezone: rule?.timezone ?? OK_TZ, rules: rule?.rules ?? [], name: rule?.name };
}
// Replaces ALL rules of the event type — always start from getAvailability().
export async function setAvailability(eventType: CalEventType, a: { timezone: string; rules: CalRule[] }): Promise<void> {
  await cal(`/event_type_availability_schedules?event_type=${encodeURIComponent(eventType.uri)}`, {
    method: "PATCH",
    body: { availability_rule: { timezone: a.timezone, rules: a.rules } },
  });
}

// Open start times between two moments (Calendly allows at most 31 days per ask).
export async function availableTimes(eventType: CalEventType, start: Date, end: Date): Promise<string[]> {
  const out: string[] = [];
  for (let s = start; s < end; ) {
    const e = new Date(Math.min(end.getTime(), s.getTime() + 30 * 86_400_000));
    const q = new URLSearchParams({ event_type: eventType.uri, start_time: s.toISOString(), end_time: e.toISOString() });
    const r = await cal<{ collection: { start_time: string; status: string }[] }>(`/event_type_available_times?${q}`);
    out.push(...r.collection.filter((x) => x.status === "available").map((x) => x.start_time));
    s = e;
  }
  return out;
}

// Busy blocks (his Google Calendar events + Calendly bookings), at most 7 days per ask.
export type CalBusy = { type: string; start_time: string; end_time: string };
export async function busyTimes(user: CalUser, start: Date, end: Date): Promise<CalBusy[]> {
  const out: CalBusy[] = [];
  for (let s = start; s < end; ) {
    const e = new Date(Math.min(end.getTime(), s.getTime() + 7 * 86_400_000));
    const q = new URLSearchParams({ user: user.uri, start_time: s.toISOString(), end_time: e.toISOString() });
    out.push(...(await cal<{ collection: CalBusy[] }>(`/user_busy_times?${q}`)).collection);
    s = e;
  }
  return out;
}
