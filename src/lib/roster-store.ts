"use client";

import type { Account, Elevator } from "@/lib/data";

// The elevator list, kept on the phone so every screen opens instantly.
//
// Reading the dashboard from Google takes ~0.5–1s, so instead of making the
// screen wait: show the last list we had (saved on this phone) right away, then
// quietly fetch a fresh copy and swap it in. Every tab (Today, Elevators, Money)
// reads this one copy, so switching tabs never waits either.
//
// Screens read it with `useRoster()` in page.tsx (React's useSyncExternalStore).

const STORAGE_KEY = "eei_roster_v1";

export type RosterState = { accounts: Account[] | null; error: string };

let state: RosterState | undefined; // undefined = not read from the phone yet
const listeners = new Set<() => void>();

function set(next: RosterState) {
  state = next;
  listeners.forEach((l) => l());
}

export function subscribeRoster(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// The current list. First call reads the copy saved on this phone (if any).
export function getRoster(): RosterState {
  if (state === undefined) {
    let saved: Account[] | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Account[] | null;
    } catch {
      saved = null;
    }
    state = { accounts: Array.isArray(saved) ? saved : null, error: "" };
  }
  return state;
}

// On the server there is no phone storage — screens render as "loading".
const SERVER_STATE: RosterState = { accounts: null, error: "" };
export const getServerRoster = () => SERVER_STATE;

function save(accounts: Account[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  } catch {
    /* storage full or blocked — the in-memory copy still works */
  }
}

// Fetch a fresh list from the dashboard and swap it in. Two calls at once share
// one request. A failure keeps showing the old list and just records the error.
let inFlight: Promise<void> | null = null;
export function refreshRoster(): Promise<void> {
  inFlight ??= (async () => {
    try {
      const res = await fetch("/api/roster", { cache: "no-store" });
      const data = (await res.json()) as { accounts?: Account[]; error?: string };
      if (!res.ok || !data.accounts) throw new Error(data.error || `Error ${res.status}`);
      save(data.accounts);
      set({ accounts: data.accounts, error: "" });
    } catch (e) {
      set({ ...getRoster(), error: e instanceof Error ? e.message : "Couldn't reach the dashboard" });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// After the app saves a change to one elevator (a lifecycle step, its switch),
// update the phone's copy too so every tab shows it without waiting for a refresh.
export function patchElevator(e: Elevator) {
  const cur = getRoster().accounts;
  if (!cur) return;
  const next = cur.map((a) => ({ ...a, units: a.units.map((u) => (u.okla === e.okla ? e : u)) }));
  save(next);
  set({ ...getRoster(), accounts: next });
}
