"use client";

import { useEffect, useRef, useState } from "react";

type Info = { building: string; okla: string; alreadyPO?: string };

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

  const wrap: React.CSSProperties = {
    maxWidth: 460, margin: "0 auto", padding: "32px 20px",
    fontFamily: "system-ui, Segoe UI, Roboto, sans-serif", color: "#1a1a1a",
  };
  const label: React.CSSProperties = { display: "block", fontWeight: 600, margin: "18px 0 6px" };
  const input: React.CSSProperties = {
    width: "100%", padding: "12px 14px", fontSize: 16, border: "1px solid #cbd2d9",
    borderRadius: 10, boxSizing: "border-box",
  };
  const btn: React.CSSProperties = {
    width: "100%", padding: "14px", fontSize: 16, fontWeight: 600, marginTop: 22,
    background: busy ? "#7aa7c7" : "#1f6feb", color: "#fff", border: "none", borderRadius: 10,
    cursor: busy ? "default" : "pointer",
  };

  if (!token) {
    return <main style={wrap}><p style={{ fontSize: 17 }}>This link is missing its code. Please use the link from your quote email.</p></main>;
  }
  if (loadErr) return <main style={wrap}><p style={{ fontSize: 17 }}>{loadErr}</p></main>;
  if (!info) return <main style={wrap}><p>Loading…</p></main>;

  if (done) {
    return (
      <main style={wrap}>
        <h1 style={{ fontSize: 22 }}>Got it — thank you.</h1>
        <p style={{ fontSize: 17, lineHeight: 1.5 }}>
          We&apos;ve received PO <strong>{po.trim()}</strong> for {info.building}. Nothing else is needed from you.
        </p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Send us your PO</h1>
      <p style={{ color: "#52606d", marginTop: 0 }}>For {info.building} (Elevator #{info.okla})</p>
      {info.alreadyPO ? (
        <p style={{ background: "#fff8e1", padding: "10px 12px", borderRadius: 8, fontSize: 14 }}>
          We already have PO <strong>{info.alreadyPO}</strong> on file. Submitting again will replace it.
        </p>
      ) : null}
      <form onSubmit={submit}>
        <label style={label} htmlFor="po">PO number</label>
        <input id="po" style={input} value={po} onChange={(e) => setPo(e.target.value)}
          placeholder="e.g. 4500123987" autoComplete="off" />
        <label style={label} htmlFor="file">Attach the PO (optional)</label>
        <input id="file" ref={fileRef} type="file" style={{ ...input, padding: 10 }} />
        {submitErr ? <p style={{ color: "#c92a2a", marginTop: 12 }}>{submitErr}</p> : null}
        <button type="submit" style={btn} disabled={busy}>{busy ? "Sending…" : "Submit PO"}</button>
      </form>
    </main>
  );
}
