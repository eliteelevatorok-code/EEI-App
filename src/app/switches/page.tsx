"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type State = { master: boolean; elevators: { on: boolean }[] };

const BRAND = "#1F4B45";

// The master switch page. Turning everything OFF takes two deliberate steps
// (a warning, then typing STOP) so it can't be tripped by accident. Turning it
// back on takes one confirm. Each elevator has its own switch on its profile.
export default function SwitchesPage() {
  const [state, setState] = useState<State | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [step, setStep] = useState<null | "stop1" | "stop2" | "resume">(null);
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
      .catch(() => setLoadErr("Couldn't load the switch. Reload and try again."));
  }, []);

  const close = () => { setStep(null); setTyped(""); setErr(""); };

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
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (loadErr) return <main className="mx-auto max-w-md p-6"><p className="text-sm text-red-700">{loadErr}</p></main>;
  if (!state) return <main className="mx-auto max-w-md p-6"><p className="text-sm text-stone-500">Loading…</p></main>;

  const pausedCount = state.elevators.filter((e) => !e.on).length;

  return (
    <div className="mx-auto max-w-md px-4 pb-16 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <Link href="/" className="text-xs font-semibold text-stone-600">‹ Home</Link>
        <div className="text-sm font-extrabold tracking-wide" style={{ color: BRAND }}>ELITE / MASTER SWITCH</div>
      </div>

      {err && !step && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{err}</p>}

      <section
        className="rounded-xl border-2 p-5"
        style={{ borderColor: state.master ? BRAND : "#c92a2a", background: state.master ? "#fff" : "#fff5f5" }}
      >
        <div className="text-[11px] font-bold uppercase tracking-widest text-stone-500">The whole system is</div>
        <div className="mt-1 text-4xl font-extrabold" style={{ color: state.master ? BRAND : "#c92a2a" }}>
          {state.master ? "RUNNING" : "PAUSED"}
        </div>
        <p className="mt-3 text-sm text-stone-600">
          {state.master
            ? "Every automatic email, invoice, and payment step is active. Pausing halts all of them at once."
            : "Everything automatic is halted. Nothing will happen until you resume."}
        </p>
        {state.master ? (
          <button
            onClick={() => setStep("stop1")}
            className="mt-4 w-full rounded-lg bg-red-600 py-3.5 text-base font-bold uppercase tracking-wider text-white active:opacity-90"
          >
            Pause everything
          </button>
        ) : (
          <button
            onClick={() => setStep("resume")}
            className="mt-4 w-full rounded-lg py-3.5 text-base font-bold uppercase tracking-wider text-white active:opacity-90"
            style={{ background: BRAND }}
          >
            Resume everything
          </button>
        )}
      </section>

      <p className="mt-4 px-1 text-xs text-stone-500">
        To pause a single elevator, open its profile from the list — each one has its own switch.
        {pausedCount > 0 && <span className="font-semibold text-red-600"> {pausedCount} currently paused.</span>}
      </p>

      {/* Step 1 of 2 — warning */}
      {step === "stop1" && (
        <ConfirmDialog
          danger
          title="Pause everything? (step 1 of 2)"
          confirmLabel="Continue"
          onCancel={close}
          onConfirm={() => setStep("stop2")}
        >
          This halts every automatic email, invoice, and payment step for <span className="font-semibold">all</span>{" "}
          elevators at once. You&apos;ll confirm once more on the next screen.
        </ConfirmDialog>
      )}

      {/* Step 2 of 2 — type STOP */}
      {step === "stop2" && (
        <ConfirmDialog
          danger
          title="Final confirmation (step 2 of 2)"
          confirmLabel="Pause all"
          busyLabel="Pausing…"
          busy={busy}
          confirmDisabled={typed.trim().toUpperCase() !== "STOP"}
          error={err}
          onCancel={close}
          onConfirm={() => setMaster(false)}
        >
          Type <span className="font-bold">STOP</span> to pause the whole system.
          <input
            autoFocus
            className="mt-3 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base text-stone-900 outline-none focus:border-red-500"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type STOP"
          />
        </ConfirmDialog>
      )}

      {/* Resume — single confirm */}
      {step === "resume" && (
        <ConfirmDialog
          title="Resume everything?"
          confirmLabel="Resume"
          busyLabel="Resuming…"
          busy={busy}
          error={err}
          onCancel={close}
          onConfirm={() => setMaster(true)}
        >
          Automatic steps start again for every elevator that is switched on.
        </ConfirmDialog>
      )}
    </div>
  );
}
