// Every button that talks to the server goes through `call` (Robert, 2026-10-28:
// "none of the buttons should ever look like they did nothing"). It's fetch with
// a time limit, so a button can never sit on "Saving…" forever on a bad signal,
// and with failures said in plain words the screen can show as-is.
//
// Browser-only (the screens and the customer pages).

export const SLOW_MSG = "That's taking too long — check your signal and try again.";
export const OFFLINE_MSG = "Couldn't reach the app — check your signal and try again.";

// fetch, but gives up after `ms` (default 30s). Throws an Error whose message is
// ready to show: SLOW_MSG when it timed out, OFFLINE_MSG when it never connected.
export async function call(url: string, init: RequestInit = {}, ms = 30_000): Promise<Response> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: stop.signal });
  } catch {
    throw new Error(stop.signal.aborted ? SLOW_MSG : OFFLINE_MSG);
  } finally {
    clearTimeout(timer);
  }
}

// POST a JSON body and read the JSON answer. Throws (with the server's own
// message when it gave one) unless the answer is OK.
export async function postJson<T = Record<string, unknown>>(url: string, body: unknown, ms?: number): Promise<T> {
  const r = await call(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, ms);
  const d = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(d.error || `Something went wrong (code ${r.status}). Try again.`);
  return d;
}
