"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button, Glass, Pill, Screen, Title, TopBar } from "@/components/ui";

type State = { master: boolean; elevators: { on: boolean }[] };

// The master switch page. Turning everything OFF takes two deliberate steps
// (a warning, then typing STOP) so it can't be tripped by accident. Turning it
// back on takes one confirm. Each elevator has its own switch on its profile.
export default function SwitchesPage() {
  const router = useRouter();
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

  if (loadErr) return <Screen><p className="mt-10 text-center text-danger">{loadErr}</p></Screen>;
  if (!state) return <Screen><p className="mt-10 text-center text-sm text-ink-3">Loading…</p></Screen>;

  const pausedCount = state.elevators.filter((e) => !e.on).length;

  return (
    <Screen>
      <TopBar back={{ label: "Home", onClick: () => router.push("/") }} />
      <Title eyebrow="Master switch">The whole system</Title>

      {err && !step && <p className="mt-4 text-sm font-semibold text-danger">{err}</p>}

      <Glass pad className="mt-6">
        <Pill tone={state.master ? "green" : "red"} dot>
          {state.master ? "Running" : "Paused"}
        </Pill>
        <p className="mt-3 text-[15px] text-ink-2">
          {state.master
            ? "Every automatic email, invoice, and payment step is active. Pausing halts all of them at once."
            : "Everything automatic is halted. Nothing will happen until you resume."}
        </p>
        {state.master ? (
          <Button variant="danger" full className="mt-5" onClick={() => setStep("stop1")}>
            Pause everything
          </Button>
        ) : (
          <Button full className="mt-5" onClick={() => setStep("resume")}>
            Resume everything
          </Button>
        )}
      </Glass>

      <p className="mt-3 px-1 text-sm text-ink-3">
        To pause a single elevator, open its profile from the list — each one has its own switch.
        {pausedCount > 0 && <span className="font-semibold text-danger"> {pausedCount} currently paused.</span>}
      </p>

      {/* Step 1 of 2 — warning */}
      {step === "stop1" && (
        <ConfirmDialog
          danger
          title="Pause everything?"
          confirmLabel="Continue"
          onCancel={close}
          onConfirm={() => setStep("stop2")}
        >
          This halts every automatic email, invoice, and payment step for <span className="font-semibold text-ink">all</span>{" "}
          elevators at once. You&apos;ll confirm once more.
        </ConfirmDialog>
      )}

      {/* Step 2 of 2 — type STOP */}
      {step === "stop2" && (
        <ConfirmDialog
          danger
          title="Final confirmation"
          confirmLabel="Pause all"
          busyLabel="Pausing…"
          busy={busy}
          confirmDisabled={typed.trim().toUpperCase() !== "STOP"}
          error={err}
          onCancel={close}
          onConfirm={() => setMaster(false)}
        >
          Type <span className="font-bold text-ink">STOP</span> to pause the whole system.
          <input
            autoFocus
            className="input mt-3"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type STOP"
          />
        </ConfirmDialog>
      )}

      {/* Resume — single confirm */}
      {step === "resume" && (
        <ConfirmDialog
          title="Turn the whole system on?"
          confirmLabel="Resume"
          busyLabel="Resuming…"
          busy={busy}
          error={err}
          onCancel={close}
          onConfirm={() => setMaster(true)}
        >
          Within the hour, customers start getting the automatic emails again — quotes, safety-test questions,
          scheduling links, reports, invoices and reminders — for the{" "}
          <span className="font-semibold text-ink">{state.elevators.filter((e) => e.on).length} elevators</span> that are switched
          on. Look over the Today tab first if you haven&apos;t in a while.
        </ConfirmDialog>
      )}
    </Screen>
  );
}
