"use client";

import { useEffect, useState } from "react";
import { Button, Field, Notice, PublicPage } from "@/components/ui";
import { APRIL, WHERE_TO_FIND, safetyAnswer, toIsoDate } from "@/lib/records";

type Info = { building: string; okla: string; maintCo?: string; alreadyResult?: string; alreadyDate?: string };

// The records form, opened from the "Records needed" email (sent to American
// Elevator, or straight to the customer for other maintenance companies — see
// src/lib/records.ts). Two questions: a passing safety test in the last 12
// months (Yes/No), and its date. Answers land on the dashboard (cols AM/AN).
// Anyone who'd rather talk can call April instead.
export default function MaintForm({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [result, setResult] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [submitErr, setSubmitErr] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch(`/api/maint?t=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return (await r.json()) as Info;
      })
      .then((d) => {
        setInfo(d);
        const prev = safetyAnswer(d.alreadyResult);
        if (prev) setResult(prev);
        if (d.alreadyDate) setDate(toIsoDate(d.alreadyDate));
      })
      .catch(() => setLoadErr(`We couldn't find this link. Please use the link from our email, or call ${APRIL.name} at ${APRIL.phone}.`));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (result !== "Yes" && result !== "No") {
      setSubmitErr("Please choose Yes or No.");
      return;
    }
    if (result === "Yes" && !date.trim()) {
      setSubmitErr("Please enter the date of the safety test.");
      return;
    }
    setBusy(true);
    setSubmitErr("");
    try {
      const r = await fetch("/api/maint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, result, date: date.trim() }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      setDone(true);
    } catch (err) {
      setSubmitErr(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const callApril = (
    <p className="mt-5 text-center text-sm text-ink-2">
      Rather talk it through? Call {APRIL.name} at{" "}
      <a className="font-semibold text-accent-ink" href={`tel:${APRIL.tel}`}>
        {APRIL.phone}
      </a>
      .
    </p>
  );

  if (!token) {
    return <PublicPage title="Link incomplete">This link is missing its code. Please use the link from our email.</PublicPage>;
  }
  if (loadErr) return <PublicPage title="Link not found">{loadErr}</PublicPage>;
  if (!info) return <PublicPage><p className="text-center text-sm text-ink-3">Loading…</p></PublicPage>;

  if (done) {
    return (
      <PublicPage title="Got it — thank you.">
        <p className="text-[15px] text-ink-2">
          We&apos;ve recorded your answer for {info.building}. Nothing else is needed from you.
        </p>
      </PublicPage>
    );
  }

  return (
    <PublicPage title="Before your inspection" subtitle={<>For {info.building} (Elevator #{info.okla})</>}>
      <p className="mb-4 text-[15px] text-ink-2">We need two quick answers before the state inspection.</p>
      <Notice>{WHERE_TO_FIND}</Notice>
      <form onSubmit={submit}>
        <Field label="Has the elevator had a passing safety test in the last 12 months?">
          <div className="grid grid-cols-2 gap-2.5">
            {["Yes", "No"].map((v) => (
              <button key={v} type="button" onClick={() => setResult(v)} className={"btn " + (result === v ? "btn-primary" : "btn-secondary")}>
                {v}
              </button>
            ))}
          </div>
        </Field>
        {result !== "No" && (
          <Field label="What date was that safety test?">
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        {submitErr ? <p className="mt-3 text-sm font-semibold text-danger">{submitErr}</p> : null}
        <Button type="submit" full className="mt-5" disabled={busy}>
          {busy ? "Sending…" : "Send answers"}
        </Button>
      </form>
      {callApril}
    </PublicPage>
  );
}
