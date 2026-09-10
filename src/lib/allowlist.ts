// App-side login allowlist. Only these people may use the app. This FAILS
// CLOSED: anyone whose email isn't on the list (or whose email can't be read)
// is turned away. The four approved emails are baked in here so enforcement
// never depends on a server setting being present. ALLOWLIST_EMAILS, if set,
// overrides this list (comma-separated) — handy for changing it without a code
// change — but the app is locked down out of the box either way.
const DEFAULT_APPROVED = [
  "rlassiter.ok@gmail.com",
  "elite.elevator.ok@gmail.com",
  "a.lassiter.ok@gmail.com",
  "s.barton.ok@gmail.com",
];

export function allowedEmails(): Set<string> {
  const fromEnv = (process.env.ALLOWLIST_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const list = fromEnv.length ? fromEnv : DEFAULT_APPROVED.map((e) => e.toLowerCase());
  return new Set(list);
}

// True only for a known-good email. Missing/blank email → false (locked out).
export function isAllowed(email: string | undefined | null): boolean {
  return Boolean(email && allowedEmails().has(email.toLowerCase()));
}
