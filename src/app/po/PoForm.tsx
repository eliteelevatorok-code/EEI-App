"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, Notice, PublicPage } from "@/components/ui";
import { PO_CLOSED } from "@/lib/oldLinks";
import { logEvent, startPageLog } from "@/lib/pageLog";
import { call } from "@/lib/net";

type Info = { building: string; okla: string; alreadyPO?: string; invoiced?: boolean; closed?: boolean };

// How long to wait for the server before telling the customer something's wrong
// (a PO with a photo attached on a slow phone signal can take a while).
const SEND_TIMEOUT_MS = 60_000;
const CALL_US = "If it keeps happening, please reply to our email or call (405) 213-9779.";

// The "Send us your PO" screen. The customer sees only their building name, a PO
// box, and an optional attach button. Submitting drops the PO into the dashboard row.
//
// Robert, 2026-10-28: on an Android phone, from the Gmail app, tapping "Submit PO"
// visibly pressed the button but nothing else happened. So the button doesn't
// rely on the form's submit event alone: the tap itself sends (the form's submit
// still works for the keyboard's Go/Enter), the typed number is read straight
// from the box, the button says "Sending…" at once, every outcome shows a
// message, and each step is reported to the dashboard's Page log tab.
export default function PoForm({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [po, setPo] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const poRef = useRef<HTMLInputElement>(null);
  const sending = useRef(false); // a second tap while sending does nothing

  useEffect(() => {
    if (!token) return;
    startPageLog("po", token);
    fetch(`/api/po?t=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`answer ${r.status}`);
        return (await r.json()) as Info;
      })
      .then((d) => {
        setInfo(d);
        logEvent("form shown", d.closed ? "link expired" : d.alreadyPO ? `PO ${d.alreadyPO} already on file` : "");
      })
      .catch((e) => {
        logEvent("page didn't load", e instanceof Error ? e.message : String(e));
        setLoadErr("We couldn't find this link. Please use the link from your quote email, or reply to us.");
      });
  }, [token]);

  async function submit(how: string) {
    if (sending.current) return;
    // The box itself, in case the phone's keyboard hadn't passed the last
    // keystrokes on yet.
    const value = (poRef.current?.value ?? po).trim();
    logEvent("Submit PO tapped", `${how}; PO "${value}"`);
    if (!value) {
      setSubmitErr("Please enter your PO number.");
      return;
    }
    // (Our host's firewall drops messages containing these, which would look like a network error.)
    if (/[<>]/.test(value)) {
      setSubmitErr("Please leave out the < and > characters.");
      return;
    }
    const f = fileRef.current?.files?.[0];
    // Same 4 MB cap as the server (our host rejects bigger uploads outright).
    if (f && f.size > 4 * 1024 * 1024) {
      setSubmitErr("That file is over 4 MB — please attach a smaller one, or send just the PO number.");
      return;
    }
    sending.current = true;
    setBusy(true);
    setSubmitErr("");
    setPo(value);
    const fd = new FormData();
    fd.set("token", token);
    fd.set("po", value);
    if (f) fd.set("file", f);
    try {
      const r = await call("/api/po", { method: "POST", body: fd }, SEND_TIMEOUT_MS);
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      logEvent("server answered", `${r.status}${data.error ? ": " + data.error : ""}`);
      if (r.ok) setDone(true);
      else setSubmitErr(data.error || `Something went wrong (code ${r.status}). Please try again. ${CALL_US}`);
    } catch (err) {
      // Never reached the server, or no answer in time.
      const msg = err instanceof Error ? err.message : String(err);
      logEvent("send failed", msg);
      setSubmitErr(`${msg} ${CALL_US}`);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (!token) {
    return <PublicPage title="Link incomplete">This link is missing its code. Please use the link from your quote email.</PublicPage>;
  }
  if (loadErr) return <PublicPage title="Link not found">{loadErr}</PublicPage>;
  if (!info) return <PublicPage><p className="text-center text-sm text-ink-3">Loading…</p></PublicPage>;

  if (info.closed) return <PublicPage title="This link has expired">{PO_CLOSED}</PublicPage>;

  if (done) {
    return (
      <PublicPage title="Got it — thank you.">
        <p className="text-[15px] text-ink-2">
          We&apos;ve received PO <span className="font-semibold text-ink">{po.trim()}</span> for {info.building}. Nothing else is
          needed from you.
        </p>
      </PublicPage>
    );
  }

  return (
    <PublicPage title="Send us your PO" subtitle={<>For {info.building} (Elevator #{info.okla})</>}>
      {info.alreadyPO ? (
        <Notice tone="warn">
          We already have PO <span className="font-semibold">{info.alreadyPO}</span> on file.{" "}
          {info.invoiced
            ? "Your invoice has already gone out with it — to change it, please reply to our email or call (405) 213-9779."
            : "Submitting again will replace it."}
        </Notice>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit("keyboard");
        }}
      >
        <Field label="PO number">
          <input ref={poRef} className="input" value={po} onChange={(e) => setPo(e.target.value)} placeholder="e.g. 4500123987" autoComplete="off" enterKeyHint="send" />
        </Field>
        <Field label="Attach the PO (optional, up to 4 MB)">
          <input ref={fileRef} type="file" onChange={() => logEvent("file picked", fileRef.current?.files?.[0]?.name ?? "")} className="input text-sm file:mr-3 file:rounded-full file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:font-semibold file:text-accent-ink" />
        </Field>
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
            // Send from the tap itself; don't wait for the form's submit event.
            e.preventDefault();
            submit("tap");
          }}
        >
          {busy ? "Sending…" : "Submit PO"}
        </Button>
      </form>
    </PublicPage>
  );
}
