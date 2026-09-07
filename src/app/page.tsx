"use client";

import { useEffect, useMemo, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import {
  ACCOUNTS,
  CERT_ISSUE,
  CONDITIONS,
  CYCLES,
  INSPECTION_TYPES,
  type Account,
  type AddedViolation,
  type Elevator,
  type LineKind,
} from "@/lib/data";
import { VHEAD, VIOLATIONS, parseViolation } from "@/lib/violations";

type Stage = "picking" | "editing";

type Report = {
  date: string;
  inspType: string;
  cycle: string;
  test1: string;
  test5: string;
  certIssue: string;
  condition: string;
  notes: string;
  added: AddedViolation[];
};

function freshReport(e: Elevator): Report {
  return {
    date: "",
    inspType: e.lastYear.inspType,
    cycle: e.cycle,
    test1: e.lastYear.test1,
    test5: e.lastYear.test5,
    certIssue: e.lastYear.certIssue,
    condition: e.lastYear.condition,
    notes: "",
    added: [],
  };
}

/* ---------- small building blocks ---------- */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3 rounded-lg border border-stone-300 bg-white p-4 shadow-sm">
      <h2 className="mb-3 border-b border-stone-200 pb-2 text-xs font-bold uppercase tracking-widest text-stone-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block last:mb-0">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-stone-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function Chips({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o === value;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={
              "rounded-full border px-3 py-2 text-sm font-semibold transition " +
              (on
                ? "border-[#1F4B45] bg-[#1F4B45] text-stone-50"
                : "border-stone-300 bg-stone-50 text-stone-700 active:bg-stone-200")
            }
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2.5 text-base outline-none focus:border-[#1F4B45] focus:ring-2 focus:ring-[#1F4B45]/20";

/* ---------- screens ---------- */

function Picker({
  onPick,
  onLock,
}: {
  onPick: (e: Elevator) => void;
  onLock: () => void;
}) {
  const [q, setQ] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "live" | "sample">("loading");
  const query = q.trim().toLowerCase();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/roster");
        const data = (await res.json()) as { accounts?: Account[]; error?: string };
        if (!res.ok || !data.accounts) throw new Error(data.error || "roster failed");
        if (!cancelled) {
          setAccounts(data.accounts);
          setLoadState("live");
        }
      } catch {
        if (!cancelled) {
          setAccounts(ACCOUNTS); // fall back to the built-in sample list
          setLoadState("sample");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    return accounts.map((a) => ({
      ...a,
      units: a.units.filter(
        (u) =>
          !query ||
          u.building.toLowerCase().includes(query) ||
          u.okla.includes(query) ||
          a.name.toLowerCase().includes(query),
      ),
    })).filter((a) => a.units.length > 0);
  }, [accounts, query]);

  return (
    <div className="mx-auto max-w-md px-4 pb-16 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-extrabold tracking-wide text-[#1F4B45]">ELITE / FIELD</div>
        <button onClick={onLock} className="text-xs font-semibold uppercase tracking-wider text-stone-500">
          Lock
        </button>
      </div>
      <h1 className="mb-3 text-lg font-bold">Pick an elevator</h1>
      <input
        className={inputCls + " mb-4"}
        placeholder="Search building or Oklahoma number"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {filtered.map((a) => (
        <div key={a.name} className="mb-4">
          <div className="mb-1 px-1 text-xs font-bold uppercase tracking-wider text-stone-500">
            {a.name}
          </div>
          <div className="flex flex-col gap-2">
            {a.units.map((u) => (
              <button
                key={u.okla}
                onClick={() => onPick(u)}
                className="rounded-lg border border-stone-300 bg-white p-3 text-left active:bg-stone-100"
              >
                <div className="font-semibold">{u.building}</div>
                <div className="mt-0.5 text-xs text-stone-500">
                  {u.city} · {u.type}
                </div>
                <div className="mt-1 font-mono text-xs font-medium text-[#1F4B45]">
                  #{u.okla} · due {u.due}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
      {loadState === "loading" && <p className="px-1 text-sm text-stone-500">Loading your list…</p>}
      {loadState !== "loading" && filtered.length === 0 && (
        <p className="px-1 text-sm text-stone-500">No matches.</p>
      )}
      {loadState === "sample" && (
        <p className="mt-4 px-1 text-xs text-amber-700">
          Showing the sample list — couldn&apos;t reach the dashboard right now.
        </p>
      )}
    </div>
  );
}

function ViolationSheet({
  addedRaws,
  onToggle,
  onClose,
}: {
  addedRaws: Set<string>;
  onToggle: (raw: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const list = VIOLATIONS.filter((v) => !query || v.toLowerCase().includes(query));
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-100">
      <div className="border-b border-stone-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest">Violation list</h3>
          <button
            onClick={onClose}
            className="rounded-full bg-[#1F4B45] px-4 py-2 text-xs font-bold uppercase tracking-wider text-stone-50"
          >
            Done
          </button>
        </div>
        <input
          className={inputCls}
          placeholder="Search the list"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>
      <div className="flex-1 overflow-auto p-3">
        <div className="mb-3 rounded-lg bg-stone-800 p-3 text-xs leading-relaxed text-stone-100">
          {VHEAD}
        </div>
        {list.map((raw) => {
          const p = parseViolation(raw);
          const picked = addedRaws.has(raw);
          return (
            <button
              key={raw}
              onClick={() => onToggle(raw)}
              className={
                "mb-2 block w-full rounded-lg border p-3 text-left text-sm " +
                (picked ? "border-[#1F4B45] bg-[#DDE8E4]" : "border-stone-300 bg-white")
              }
            >
              <div className="flex items-start justify-between gap-2">
                <span>{p.text}</span>
                {picked && (
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#1F4B45]">
                    Added
                  </span>
                )}
              </div>
              <code className="mt-1 block font-mono text-[11px] text-stone-500">{p.code}</code>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<LineKind, string> = { V: "Violation", R: "Recommend", C: "Comment" };
const KIND_COLOR: Record<LineKind, string> = {
  V: "border-l-red-600",
  R: "border-l-amber-600",
  C: "border-l-stone-400",
};

function Report({
  elevator,
  onChangeElevator,
  onLock,
}: {
  elevator: Elevator;
  onChangeElevator: () => void;
  onLock: () => void;
}) {
  const [r, setR] = useState<Report>(() => freshReport(elevator));
  const [sheet, setSheet] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Report,>(k: K, v: Report[K]) => setR((p) => ({ ...p, [k]: v }));

  const addedRaws = useMemo(() => new Set(r.added.map((a) => a.raw)), [r.added]);
  const tally = useMemo(
    () => ({
      V: r.added.filter((a) => a.kind === "V").length,
      R: r.added.filter((a) => a.kind === "R").length,
      C: r.added.filter((a) => a.kind === "C").length,
    }),
    [r.added],
  );

  function toggleViolation(raw: string) {
    setR((p) => {
      if (p.added.some((a) => a.raw === raw)) {
        return { ...p, added: p.added.filter((a) => a.raw !== raw) };
      }
      const parsed = parseViolation(raw);
      return {
        ...p,
        added: [...p.added, { raw, kind: "V", violation: parsed.text, recommendation: "", comment: "" }],
      };
    });
  }

  function setLine(raw: string, patch: Partial<AddedViolation>) {
    setR((p) => ({
      ...p,
      added: p.added.map((a) => (a.raw === raw ? { ...a, ...patch } : a)),
    }));
  }

  async function finalize() {
    if (!r.date) {
      setStatus("Add the inspection date before finalizing.");
      return;
    }
    setBusy(true);
    setStatus("Building the report PDF…");
    try {
      const res = await fetch("/api/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elevator, report: r }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || `Server error ${res.status}`);
      }
      const writeback = res.headers.get("X-Writeback") || "";
      const drive = res.headers.get("X-Drive") || "";
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank");
      const dashNote =
        writeback === "ok" ? "Dashboard updated (Visit → Inspected)." : "Dashboard update: " + writeback + ".";
      const driveNote = drive === "ok" ? "Saved to Drive." : "Drive save: " + drive + ".";
      setStatus(`Finalized ${elevator.building} (#${elevator.okla}). ${dashNote} ${driveNote}`);
    } catch (err) {
      setStatus("Couldn't build the PDF: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }
  function saveForLater() {
    // draft is kept locally for now; the shared phone↔computer draft is the next piece
    try {
      localStorage.setItem(`eei_draft_${elevator.okla}`, JSON.stringify(r));
    } catch {
      /* storage may be unavailable */
    }
    setStatus(`Saved for later — ${elevator.building} draft kept. Finishing on the computer comes next.`);
  }

  return (
    <div className="mx-auto max-w-md pb-40">
      {sheet && (
        <ViolationSheet
          addedRaws={addedRaws}
          onToggle={toggleViolation}
          onClose={() => setSheet(false)}
        />
      )}

      {/* top bar */}
      <div className="sticky top-0 z-30 border-b border-stone-200 bg-stone-100/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="text-sm font-extrabold tracking-wide text-[#1F4B45]">ELITE / FIELD</div>
          <span className="rounded-full border border-stone-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-stone-500">
            Phone
          </span>
          <div className="grow" />
          <button onClick={onChangeElevator} className="text-xs font-semibold text-stone-600">
            Change
          </button>
          <button onClick={onLock} className="text-xs font-semibold text-stone-500">
            Lock
          </button>
        </div>
      </div>

      <div className="px-4 pt-3">
        {/* data plate */}
        <div className="mb-3 rounded-lg bg-stone-800 p-4 text-stone-100">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">
            Oklahoma #
          </div>
          <div className="font-mono text-2xl font-medium">{elevator.okla}</div>
          <div className="mt-1 text-sm font-semibold">{elevator.building}</div>
          <div className="mt-2 inline-block rounded-full bg-amber-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-50">
            Due {elevator.due}
          </div>
        </div>

        {/* This visit */}
        <Card title="This visit">
          <Field label="Date inspected">
            <input
              type="date"
              className={inputCls}
              value={r.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </Field>
          <Field label="Inspection type">
            <Chips options={INSPECTION_TYPES} value={r.inspType} onChange={(v) => set("inspType", v)} />
          </Field>
          <Field label="Inspection cycle">
            <Chips options={CYCLES} value={r.cycle} onChange={(v) => set("cycle", v)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="One year test">
              <input
                className={inputCls}
                placeholder="MM/YYYY"
                value={r.test1}
                onChange={(e) => set("test1", e.target.value)}
              />
            </Field>
            <Field label="Five year test">
              <input
                className={inputCls}
                placeholder="MM/YYYY"
                value={r.test5}
                onChange={(e) => set("test5", e.target.value)}
              />
            </Field>
          </div>
          <Field label="Certificate issue">
            <Chips options={CERT_ISSUE} value={r.certIssue} onChange={(v) => set("certIssue", v)} />
          </Field>
          <Field label="Condition">
            <Chips options={CONDITIONS} value={r.condition} onChange={(v) => set("condition", v)} />
          </Field>
        </Card>

        {/* Violations */}
        <Card title="Violations, recommendations, comments">
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Tally n={tally.V} label="Violations" color="text-red-600" />
            <Tally n={tally.R} label="Recommend" color="text-amber-600" />
            <Tally n={tally.C} label="Comments" color="text-stone-600" />
          </div>
          {r.added.length === 0 && (
            <p className="mb-3 text-sm text-stone-500">None added yet.</p>
          )}
          {r.added.map((a) => (
            <div
              key={a.raw}
              className={"mb-3 overflow-hidden rounded-lg border border-l-4 border-stone-200 bg-white " + KIND_COLOR[a.kind]}
            >
              <p className="px-3 pt-3 text-sm leading-snug">{a.violation}</p>
              <code className="block px-3 pb-2 pt-1 font-mono text-[11px] text-stone-500">
                {parseViolation(a.raw).code}
              </code>
              <textarea
                className="w-full resize-none border-t border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none"
                rows={2}
                placeholder="Comment (optional)"
                value={a.comment}
                onChange={(e) => setLine(a.raw, { comment: e.target.value })}
              />
              <div className="flex border-t border-stone-200">
                {(["V", "R", "C"] as LineKind[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setLine(a.raw, { kind: k })}
                    className={
                      "flex-1 border-r border-stone-200 py-2 text-xs font-bold uppercase tracking-wider last:border-r-0 " +
                      (a.kind === k ? "bg-[#1F4B45] text-stone-50" : "text-stone-500")
                    }
                  >
                    {KIND_LABEL[k]}
                  </button>
                ))}
                <button
                  onClick={() => toggleViolation(a.raw)}
                  className="border-l border-stone-200 px-3 py-2 text-xs font-bold uppercase tracking-wider text-red-600"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={() => setSheet(true)}
            className="w-full rounded-lg border-2 border-dashed border-[#1F4B45] py-3 text-sm font-bold uppercase tracking-wider text-[#1F4B45]"
          >
            + Add from the list
          </button>
        </Card>

        {/* Field notes */}
        <Card title="Field notes">
          <Field label="Anything to fix on the computer later">
            <textarea
              className={inputCls + " min-h-24 resize-y"}
              placeholder="Owner changed hands, serial on file is wrong, new gate code…"
              value={r.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </Card>

        {/* Carried over (locked) */}
        <Card title="Carried over">
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-stone-200 p-3 text-xs leading-relaxed text-stone-600">
            <span className="font-bold uppercase tracking-wider text-amber-700">Locked</span>
            <span>
              These stay put in the field so nothing gets changed by accident. Note it above and edit it on the computer.
            </span>
          </div>
          <dl className="divide-y divide-stone-100">
            {elevator.carried.map((f) => (
              <div key={f.label} className="flex justify-between gap-4 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                  {f.label}
                </dt>
                <dd className="text-right text-sm text-stone-700">{f.value || "—"}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      {/* action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white">
        {status && (
          <div className="px-4 py-2 text-xs text-stone-600">{status}</div>
        )}
        <div className="mx-auto flex max-w-md gap-3 px-4 py-3">
          <button
            onClick={saveForLater}
            disabled={busy}
            className="flex-1 rounded-lg border border-stone-300 bg-stone-50 py-3 text-sm font-bold uppercase tracking-wider text-stone-700 active:bg-stone-200 disabled:opacity-50"
          >
            Save for later
          </button>
          <button
            onClick={finalize}
            disabled={busy}
            className="flex-1 rounded-lg bg-[#1F4B45] py-3 text-sm font-bold uppercase tracking-wider text-stone-50 active:opacity-90 disabled:opacity-60"
          >
            {busy ? "Working…" : "Finish & finalize"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tally({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white py-2 text-center">
      <div className={"font-mono text-2xl font-medium tabular-nums " + color}>{n}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">{label}</div>
    </div>
  );
}

/* ---------- root ---------- */

export default function Home() {
  const { signOut } = useClerk();
  const [stage, setStage] = useState<Stage>("picking");
  const [selected, setSelected] = useState<Elevator | null>(null);

  // "Lock" signs out of Clerk; the protected route sends them back to sign-in.
  const lock = () => signOut({ redirectUrl: "/sign-in" });

  if (stage === "picking" || !selected)
    return (
      <Picker
        onPick={(e) => {
          setSelected(e);
          setStage("editing");
        }}
        onLock={lock}
      />
    );
  return (
    <Report
      key={selected.okla}
      elevator={selected}
      onChangeElevator={() => setStage("picking")}
      onLock={lock}
    />
  );
}
