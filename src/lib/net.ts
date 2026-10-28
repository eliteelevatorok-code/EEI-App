// Every button that talks to the server goes through `call` or `postJson`
// (Robert, 2026-10-28: "none of the buttons should ever look like they did
// nothing"). It's fetch with a time limit that covers the whole answer, so a
// button can never sit on "Saving…" forever on a bad signal, and failures come
// back in plain words the screen can show as-is.
//
// Browser-only (the screens and the customer pages).

export const OFFLINE_MSG = "Couldn't reach the app — check your signal and try again.";
// A read that ran out of time can simply be tried again. A save can't be so sure:
// the server may have finished it after the phone stopped waiting.
const SLOW_READ = "That's taking too long — check your signal and try again.";
export const SLOW_SAVE = "No answer in time — it may still have saved. Reload to check before trying again.";

// fetch, but gives up after `ms` (default 30s) — counting the whole answer, not
// just its first bytes. Throws an Error whose message is ready to show. `save`:
// does this request change something? (Decides what a timeout says; by default
// anything but a GET does.)
export async function call(url: string, init: RequestInit = {}, ms = 30_000, save?: boolean): Promise<Response> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: stop.signal });
    const body = await res.arrayBuffer(); // read it all inside the time limit
    const empty = [204, 205, 304].includes(res.status); // these may not carry a body
    return new Response(empty ? null : body, { status: res.status, statusText: res.statusText, headers: res.headers });
  } catch {
    const changes = save ?? (init.method ?? "GET").toUpperCase() !== "GET";
    throw new Error(stop.signal.aborted ? (changes ? SLOW_SAVE : SLOW_READ) : OFFLINE_MSG);
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
