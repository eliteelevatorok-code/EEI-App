"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, Notice, PublicPage } from "@/components/ui";

type Info = { building: string; okla: string; alreadyPO?: string; invoiced?: boolean };

// The "Send us your PO" screen. The customer sees only their building name, a PO
// box, and an optional attach button. Submitting drops the PO into the dashboard row.
export default function PoForm({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [po, setPo] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/po?t=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return (await r.json()) as Info;
      })
      .then(setInfo)
      .catch(() => setLoadErr("We couldn't find this link. Please use the link from your quote email, or reply to us."));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!po.trim()) {
      setSubmitErr("Please enter your PO number.");
      return;
    }
    // (Our host's firewall drops messages containing these, which would look like a network error.)
    if (/[<>]/.test(po)) {
      setSubmitErr("Please leave out the < and > characters.");
      return;
    }
    const f = fileRef.current?.files?.[0];
    // Same 4 MB cap as the server (our host rejects bigger uploads outright).
    if (f && f.size > 4 * 1024 * 1024) {
      setSubmitErr("That file is over 4 MB — please attach a smaller one, or send just the PO number.");
      return;
    }
    setBusy(true);
    setSubmitErr("");
    const fd = new FormData();
    fd.set("token", token);
    fd.set("po", po.trim());
    if (f) fd.set("file", f);
    try {
      const r = await fetch("/api/po", { method: "POST", body: fd });
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
    return <PublicPage title="Link incomplete">This link is missing its code. Please use the link from your quote email.</PublicPage>;
  }
  if (loadErr) return <PublicPage title="Link not found">{loadErr}</PublicPage>;
  if (!info) return <PublicPage><p className="text-center text-sm text-ink-3">Loading…</p></PublicPage>;

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
      <form onSubmit={submit}>
        <Field label="PO number">
          <input className="input" value={po} onChange={(e) => setPo(e.target.value)} placeholder="e.g. 4500123987" autoComplete="off" />
        </Field>
        <Field label="Attach the PO (optional, up to 4 MB)">
          <input ref={fileRef} type="file" className="input text-sm file:mr-3 file:rounded-full file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:font-semibold file:text-accent-ink" />
        </Field>
        {submitErr ? <p className="mt-3 text-sm font-semibold text-danger">{submitErr}</p> : null}
        <Button type="submit" full className="mt-5" disabled={busy}>{busy ? "Sending…" : "Submit PO"}</Button>
      </form>
    </PublicPage>
  );
}
