"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, Notice, PublicPage } from "@/components/ui";
import { APRIL, checkSafetyDate, WHERE_TO_FIND, isoToday, safetyAnswer, toIsoDate } from "@/lib/records";
import { MAINT_CLOSED } from "@/lib/oldLinks";
import { logEvent, startPageLog } from "@/lib/pageLog";
import { call, postJson } from "@/lib/net";

type Info = { building: string; okla: string; maintCo?: string; alreadyResult?: string; alreadyDate?: string; closed?: boolean };

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
  const sending = useRef(false); // a second tap while sending does nothing

  useEffect(() => {
    if (!token) return;
    startPageLog("maint", token);
    call(`/api/maint?t=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`answer ${r.status}`);
        return (await r.json()) as Info;
      })
      .then((d) => {
        setInfo(d);
        const prev = safetyAnswer(d.alreadyResult);
        if (prev) setResult(prev);
        if (d.alreadyDate) setDate(toIsoDate(d.alreadyDate));
        logEvent("form shown", d.closed ? "link expired" : d.alreadyResult ? `already answered ${d.alreadyResult}` : "");
      })
      .catch((e) => {
        logEvent("page didn't load", e instanceof Error ? e.message : String(e));
        setLoadErr(`We couldn't find this link. Please use the link from our email, or call ${APRIL.name} at ${APRIL.phone}.`);
      });
  }, [token]);

  // Sends from the tap itself (the form's submit event is only the keyboard's
  // Go/Enter) — see the note in src/app/po/PoForm.tsx.
  async function submit(how: string) {
    if (sending.current) return;
    logEvent("Send answers tapped", `${how}; ${result || "no choice"} ${date}`);
    if (result !== "Yes" && result !== "No") {
      setSubmitErr("Please choose Yes or No.");
      return;
    }
    if (result === "Yes" && !date.trim()) {
      setSubmitErr("Please enter the date of the safety test.");
      return;
    }
    // (Some date boxes let the year run past 4 digits — same check the server makes.)
    const bad = result === "Yes" ? checkSafetyDate(date) : "";
    if (bad) {
      setSubmitErr(bad);
      return;
    }
    sending.current = true;
    setBusy(true);
    setSubmitErr("");
    try {
      await postJson("/api/maint", { token, result, date: date.trim() });
      logEvent("server answered", "saved");
      setDone(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logEvent("send failed", msg);
      setSubmitErr(`${msg} Or call ${APRIL.name} at ${APRIL.phone}.`);
    } finally {
      sending.current = false;
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

  if (info.closed) return <PublicPage title="This link has expired">{MAINT_CLOSED}</PublicPage>;

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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit("keyboard");
        }}
      >
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
            <input type="date" className="input" value={date} max={isoToday()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        {submitErr ? (
          <div className="mt-4" role="alert">
            <Notice tone="warn">{submitErr}</Notice>
          </div>
        ) : null}
        <Button
          type="submit"
          full
          className="mt-5"
          disabled={busy}
          onClick={(e) => {
            e.preventDefault();
            submit("tap");
          }}
        >
          {busy ? "Sending…" : "Send answers"}
        </Button>
      </form>
      {callApril}
    </PublicPage>
  );
}
