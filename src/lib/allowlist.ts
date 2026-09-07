// Free, app-side login allowlist (replaces Clerk's paid Allowlist feature).
// The approved emails live in a SERVER-ONLY env var (never shipped to the
// browser, never in the repo): ALLOWLIST_EMAILS="a@x.com,b@y.com".
//
// Safety: if ALLOWLIST_EMAILS is unset/empty, this allows everyone — so
// deploying the code changes nothing until the list is actually configured
// (it can never accidentally lock people out before it's set up).
export function allowedEmails(): Set<string> {
  return new Set(
    (process.env.ALLOWLIST_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowed(email: string | undefined | null): boolean {
  const list = allowedEmails();
  if (list.size === 0) return true; // not configured yet → don't block anyone
  return Boolean(email && list.has(email.toLowerCase()));
}
