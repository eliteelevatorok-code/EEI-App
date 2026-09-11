"use client";

import { useEffect, useState } from "react";

type Elevator = { row: number; okla: string; building: string; on: boolean };
type State = { master: boolean; elevators: Elevator[] };

const BRAND = "#1F4B45";

export default function SwitchesPage() {
  const [state, setState] = useState<State | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [q, setQ] = useState("");
  const [confirmStop, setConfirmStop] = useState(false); // master-off modal
  const [confirmGo, setConfirmGo] = useState(false); // master-on modal
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/switches")
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return (await r.json()) as State;
      })
      .then(setState)
      .catch(() => setLoadErr("Couldn't load the switches. Reload and try again."));
  }, []);

  async function setMaster(on: boolean) {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/switches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "master", on, confirm: on ? undefined : "STOP" }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(d.error || "Save failed");
      setState((s) => (s ? { ...s, master: on } : s));
      setConfirmStop(false);
      setConfirmGo(false);
      setTyped("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleElevator(el: Elevator) {
    const next = !el.on;
    // optimistic
    setState((s) => (s ? { ...s, elevators: s.elevators.map((e) => (e.row === el.row ? { ...e, on: next } : e)) } : s));
    try {
      const r = await fetch("/api/switches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "elevator", row: el.row, on: next }),
      });
      if (!r.ok) throw new Error();
    } catch {
      // revert on failure
      setState((s) => (s ? { ...s, elevators: s.elevators.map((e) => (e.row === el.row ? { ...e, on: el.on } : e)) } : s));
      setErr(`Couldn't change ${el.building}. Try again.`);
    }
  }

  if (loadErr) return <main className="mx-auto max-w-md p-6"><p className="text-sm text-red-700">{loadErr}</p></main>;
  if (!state) return <main className="mx-auto max-w-md p-6"><p className="text-sm text-stone-500">Loading…</p></main>;

  const query = q.trim().toLowerCase();
  const list = state.elevators.filter(
    (e) => !query || e.building.toLowerCase().includes(query) || e.okla.includes(query),
  );
  const offCount = state.elevators.filter((e) => !e.on).length;

  return (
    <div className="mx-auto max-w-md px-4 pb-16 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <a href="/" className="text-xs font-semibold text-stone-600">‹ Home</a>
        <div className="text-sm font-extrabold tracking-wide" style={{ color: BRAND }}>ELITE / SWITCHES</div>
      </div>
      <h1 className="mb-3 text-lg font-bold">On / off switches</h1>

      {err && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{err}</p>}

      {/* Master */}
      <section
        className="mb-4 rounded-xl border-2 p-4"
        style={{ borderColor: state.master ? BRAND : "#c92a2a", background: state.master ? "#fff" : "#fff5f5" }}
      >
        <div className="text-[11px] font-bold uppercase tracking-widest text-stone-500">Master switch</div>
        <div className="mt-1 flex items-center justify-between">
          <div className="text-2xl font-bold" style={{ color: state.master ? BRAND : "#c92a2a" }}>
            {state.master ? "RUNNING" : "PAUSED"}
          </div>
          {state.master ? (
            <button
              onClick={() => setConfirmStop(true)}
              className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-white active:opacity-90"
            >
              Pause everything
            </button>
          ) : (
            <button
              onClick={() => setConfirmGo(true)}
              className="rounded-lg px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-white active:opacity-90"
              style={{ background: BRAND }}
            >
              Resume everything
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-stone-500">
          {state.master
            ? "Everything is running. Pause to halt all automatic emails, invoices, and payment steps at once."
            : "Everything is halted. Nothing automatic will happen until you resume."}
        </p>
      </section>

      {/* Per-elevator */}
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-xs font-bold uppercase tracking-wider text-stone-500">Each elevator</div>
        {offCount > 0 && <div className="text-xs font-semibold text-red-600">{offCount} paused</div>}
      </div>
      <input
        className="mb-3 w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2.5 text-base outline-none focus:border-[#1F4B45]"
        placeholder="Search building or Oklahoma number"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {!state.master && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The master switch is off, so these are all paused no matter what each one shows.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {list.map((e) => (
          <div key={e.row} className="flex items-center justify-between rounded-lg border border-stone-300 bg-white p-3">
            <div className="min-w-0">
              <div className="truncate font-semibold">{e.building || "—"}</div>
              <div className="font-mono text-xs text-stone-500">#{e.okla}</div>
            </div>
            <button
              onClick={() => toggleElevator(e)}
              className={
                "ml-3 shrink-0 rounded-full border px-4 py-2 text-sm font-bold uppercase tracking-wider " +
                (e.on ? "text-stone-50" : "border-red-300 bg-red-50 text-red-700")
              }
              style={e.on ? { background: BRAND, borderColor: BRAND } : undefined}
            >
              {e.on ? "On" : "Off"}
            </button>
          </div>
        ))}
        {list.length === 0 && <p className="px-1 text-sm text-stone-500">No matches.</p>}
      </div>

      {/* Pause-everything gate: must type STOP */}
      {confirmStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h4 className="text-base font-bold text-red-700">Pause everything?</h4>
            <p className="mt-2 text-sm text-stone-600">
              This halts every automatic email, invoice, and payment step for all elevators. To confirm, type
              <span className="font-bold"> STOP</span> below.
            </p>
            <input
              autoFocus
              className="mt-3 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base outline-none focus:border-red-500"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type STOP"
            />
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => { setConfirmStop(false); setTyped(""); }}
                disabled={busy}
                className="flex-1 rounded-lg border border-stone-300 bg-stone-50 py-3 text-sm font-bold uppercase tracking-wider text-stone-700"
              >
                Cancel
              </button>
              <button
                onClick={() => setMaster(false)}
                disabled={busy || typed.trim().toUpperCase() !== "STOP"}
                className="flex-1 rounded-lg bg-red-600 py-3 text-sm font-bold uppercase tracking-wider text-white disabled:opacity-40"
              >
                {busy ? "Pausing…" : "Pause all"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resume-everything confirm */}
      {confirmGo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h4 className="text-base font-bold" style={{ color: BRAND }}>Resume everything?</h4>
            <p className="mt-2 text-sm text-stone-600">
              Automatic steps start running again for every elevator that is switched on.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setConfirmGo(false)}
                disabled={busy}
                className="flex-1 rounded-lg border border-stone-300 bg-stone-50 py-3 text-sm font-bold uppercase tracking-wider text-stone-700"
              >
                Cancel
              </button>
              <button
                onClick={() => setMaster(true)}
                disabled={busy}
                className="flex-1 rounded-lg py-3 text-sm font-bold uppercase tracking-wider text-white disabled:opacity-60"
                style={{ background: BRAND }}
              >
                {busy ? "Resuming…" : "Resume"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
