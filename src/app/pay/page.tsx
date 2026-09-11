"use client";

import { useEffect, useState } from "react";

type Info = { building: string; price?: string; alreadyPaid?: boolean };

// Public, login-free page reached from the "pay" button in the invoice email
// (…/pay?t=<token>). Shows the building and amount and a single button that marks
// the invoice paid, so the lifecycle can continue. In the live system the same
// paid state comes from QuickBooks; this button stands in for it during testing.
export default function PayPage() {
  const [token, setToken] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [submitErr, setSubmitErr] = useState("");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t") ?? "";
    setToken(t);
    if (!t) {
      setLoadErr("This link is missing its code. Please use the link from your invoice email.");
      return;
    }
    fetch(`/api/pay?t=${encodeURIComponent(t)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return (await r.json()) as Info;
      })
      .then((d) => {
        setInfo(d);
        if (d.alreadyPaid) setDone(true);
      })
      .catch(() => setLoadErr("We couldn't find this link. Please use the link from your invoice email."));
  }, []);

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

  const wrap: React.CSSProperties = {
    maxWidth: 460, margin: "0 auto", padding: "32px 20px",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: "#1a1a1a",
  };
  const btn: React.CSSProperties = {
    width: "100%", padding: "14px", fontSize: 16, fontWeight: 600, marginTop: 22,
    background: busy ? "#7aa7c7" : "#1f6feb", color: "#fff", border: "none", borderRadius: 10,
    cursor: busy ? "default" : "pointer",
  };

  if (loadErr) return <main style={wrap}><p style={{ fontSize: 17 }}>{loadErr}</p></main>;
  if (!info) return <main style={wrap}><p>Loading…</p></main>;

  if (done) {
    return (
      <main style={wrap}>
        <h1 style={{ fontSize: 22 }}>Payment recorded — thank you.</h1>
        <p style={{ fontSize: 17, lineHeight: 1.5 }}>
          {info.building} is marked paid. Nothing else is needed from you.
        </p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Pay your invoice</h1>
      <p style={{ color: "#52606d", marginTop: 0 }}>For {info.building}</p>
      {info.price ? (
        <p style={{ fontSize: 20, fontWeight: 700, margin: "12px 0" }}>Amount due: {info.price}</p>
      ) : null}
      {submitErr ? <p style={{ color: "#c92a2a", marginTop: 12 }}>{submitErr}</p> : null}
      <button type="button" style={btn} disabled={busy} onClick={pay}>
        {busy ? "Recording…" : "Pay now"}
      </button>
    </main>
  );
}
