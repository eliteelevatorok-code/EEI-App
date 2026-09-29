"use client";

import { useEffect, useState } from "react";
import { Button, Field, PublicPage } from "@/components/ui";

type Info = { building: string; okla: string; maintCo?: string; alreadyResult?: string; alreadyDate?: string };

// The "Records needed" screen. The maintenance company answers two things about
// the elevator's last state inspection — did it pass, and the date — and submits.
// Those land on the dashboard (cols AM/AN) and feed the upcoming report.
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
        if (d.alreadyResult) setResult(d.alreadyResult);
        if (d.alreadyDate) setDate(d.alreadyDate);
      })
      .catch(() => setLoadErr("We couldn't find this link. Please use the link from our email, or reply to us."));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (result !== "Pass" && result !== "Fail") {
      setSubmitErr("Please choose Pass or Fail.");
      return;
    }
    if (!date.trim()) {
      setSubmitErr("Please enter the date it was last inspected.");
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
    <PublicPage title="Records needed" subtitle={<>For {info.building} (Elevator #{info.okla})</>}>
      <p className="mb-5 text-[15px] text-ink-2">
        For the upcoming state inspection, please tell us two things about this elevator&apos;s{" "}
        <span className="font-semibold text-ink">last</span> inspection:
      </p>
      <form onSubmit={submit}>
        <Field label="Did it pass its last inspection?">
          <div className="grid grid-cols-2 gap-2.5">
            {["Pass", "Fail"].map((v) => (
              <button key={v} type="button" onClick={() => setResult(v)} className={"btn " + (result === v ? "btn-primary" : "btn-secondary")}>
                {v}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Date it was last inspected">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {submitErr ? <p className="mt-3 text-sm font-semibold text-danger">{submitErr}</p> : null}
        <Button type="submit" full className="mt-5" disabled={busy}>{busy ? "Sending…" : "Submit"}</Button>
      </form>
    </PublicPage>
  );
}
