"use client";

import { useEffect, useState } from "react";
import { Button, PublicPage } from "@/components/ui";

type Info = { building: string; price?: string; alreadyPaid?: boolean };

// The "Pay now" screen. Shows the building and amount and one button that marks
// the invoice paid so the lifecycle can continue. In the live system the paid
// state comes from QuickBooks; this button stands in for it during testing (the
// server refuses it once QuickBooks is on the real company — see /api/pay).
export default function PayForm({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [submitErr, setSubmitErr] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch(`/api/pay?t=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return (await r.json()) as Info;
      })
      .then((d) => {
        setInfo(d);
        if (d.alreadyPaid) setDone(true);
      })
      .catch(() => setLoadErr("We couldn't find this link. Please use the link from your invoice email."));
  }, [token]);

  async function pay() {
    setBusy(true);
    setSubmitErr("");
    try {
      const r = await fetch("/api/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
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
    return <PublicPage title="Link incomplete">This link is missing its code. Please use the link from your invoice email.</PublicPage>;
  }
  if (loadErr) return <PublicPage title="Link not found">{loadErr}</PublicPage>;
  if (!info) return <PublicPage><p className="text-center text-sm text-ink-3">Loading…</p></PublicPage>;

  if (done) {
    return (
      <PublicPage title="Payment recorded — thank you.">
        <p className="text-[15px] text-ink-2">{info.building} is marked paid. Nothing else is needed from you.</p>
      </PublicPage>
    );
  }

  return (
    <PublicPage title="Pay your invoice" subtitle={<>For {info.building}</>}>
      {info.price ? (
        <div className="flex items-baseline justify-between rounded-control bg-accent-soft px-4 py-4">
          <span className="text-sm font-medium text-accent-ink">Amount due</span>
          <span className="text-3xl font-bold tracking-tight text-accent-ink">{info.price}</span>
        </div>
      ) : null}
      {submitErr ? <p className="mt-3 text-sm font-semibold text-danger">{submitErr}</p> : null}
      <Button type="button" full className="mt-5" disabled={busy} onClick={pay}>
        {busy ? "Recording…" : "Pay now"}
      </Button>
    </PublicPage>
  );
}
