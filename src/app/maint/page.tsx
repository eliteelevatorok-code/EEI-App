"use client";

import { useEffect, useState } from "react";

type Info = { building: string; okla: string; maintCo?: string; alreadyResult?: string; alreadyDate?: string };

// Public, login-free page. The maintenance company reaches it from the "Records
// needed" email (…/maint?t=<token>). They answer two things about the elevator's
// last state inspection — did it pass, and the date — and submit. Those feed the
// upcoming report.
export default function MaintPage() {
  const [token, setToken] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [result, setResult] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [submitErr, setSubmitErr] = useState("");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t") ?? "";
    setToken(t);
    if (!t) {
      setLoadErr("This link is missing its code. Please use the link from our email.");
      return;
    }
    fetch(`/api/maint?t=${encodeURIComponent(t)}`)
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
  }, []);

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

  const wrap: React.CSSProperties = {
    maxWidth: 460, margin: "0 auto", padding: "32px 20px",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: "#1a1a1a",
  };
  const label: React.CSSProperties = { display: "block", fontWeight: 600, margin: "18px 0 8px" };
  const input: React.CSSProperties = {
    width: "100%", padding: "12px 14px", fontSize: 16, border: "1px solid #cbd2d9",
    borderRadius: 10, boxSizing: "border-box",
  };
  const btn: React.CSSProperties = {
    width: "100%", padding: "14px", fontSize: 16, fontWeight: 600, marginTop: 24,
    background: busy ? "#7aa7c7" : "#1f6feb", color: "#fff", border: "none", borderRadius: 10,
    cursor: busy ? "default" : "pointer",
  };
  const choice = (v: string): React.CSSProperties => ({
    flex: 1, padding: "12px", fontSize: 16, fontWeight: 600, borderRadius: 10, cursor: "pointer",
    border: "1px solid " + (result === v ? "#1f6feb" : "#cbd2d9"),
    background: result === v ? "#1f6feb" : "#f6f8fa",
    color: result === v ? "#fff" : "#1a1a1a",
  });

  if (loadErr) return <main style={wrap}><p style={{ fontSize: 17 }}>{loadErr}</p></main>;
  if (!info) return <main style={wrap}><p>Loading…</p></main>;

  if (done) {
    return (
      <main style={wrap}>
        <h1 style={{ fontSize: 22 }}>Got it — thank you.</h1>
        <p style={{ fontSize: 17, lineHeight: 1.5 }}>
          We&apos;ve recorded your answer for {info.building}. Nothing else is needed from you.
        </p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Records needed</h1>
      <p style={{ color: "#52606d", marginTop: 0 }}>For {info.building} (Elevator #{info.okla})</p>
      <p style={{ fontSize: 15, lineHeight: 1.5, marginTop: 12 }}>
        For the upcoming state inspection, please tell us two things about this elevator&apos;s <strong>last</strong> inspection:
      </p>
      <form onSubmit={submit}>
        <label style={label}>Did it pass its last inspection?</label>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" style={choice("Pass")} onClick={() => setResult("Pass")}>Pass</button>
          <button type="button" style={choice("Fail")} onClick={() => setResult("Fail")}>Fail</button>
        </div>
        <label style={label} htmlFor="date">Date it was last inspected</label>
        <input id="date" type="date" style={input} value={date} onChange={(e) => setDate(e.target.value)} />
        {submitErr ? <p style={{ color: "#c92a2a", marginTop: 12 }}>{submitErr}</p> : null}
        <button type="submit" style={btn} disabled={busy}>{busy ? "Sending…" : "Submit"}</button>
      </form>
    </main>
  );
}
