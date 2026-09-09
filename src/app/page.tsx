"use client";

import { useEffect, useMemo, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { getInstallState, isIOS, subscribeInstall, triggerInstall } from "@/lib/pwa-install";
import { alertsState, enableAlerts, type AlertState } from "@/lib/push-client";
import {
  CERT_ISSUE,
  CONDITIONS,
  CYCLES,
  INSPECTION_TYPES,
  type Account,
  type AddedViolation,
  type Elevator,
  type LifecycleStage,
  type LineKind,
} from "@/lib/data";
import { VHEAD, VIOLATIONS, parseViolation } from "@/lib/violations";
import { FONT_SCALES, FONT_SCALE_LABELS, currentFontScale, saveFontScale } from "@/lib/prefs";
import { computeCycle, computePrice, formatPrice } from "@/lib/pricing";

type Stage = "list" | "profile" | "report" | "new";

// Parse a m/d/yyyy (or yyyy-mm-dd) due date to a Date for sorting/coloring.
function parseDue(s: string): Date | null {
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
// Days from today until a due date (negative = overdue). null if unparseable.
function daysUntil(s: string): number | null {
  const d = parseDue(s);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}
const DUE_SOON_DAYS = 60;

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

/* ---------- settings ---------- */

// Reads the app-wide install state captured at startup (see lib/pwa-install).
// Because the browser's install event is captured on load — not when this popup
// opens — the button is available here even though the event fired earlier.
function useInstall() {
  const [state, setState] = useState(() => getInstallState());
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setIos(isIOS());
    setState(getInstallState());
    return subscribeInstall(() => setState(getInstallState()));
  }, []);
  const install = () => {
    void triggerInstall();
  };
  return { installed: state.installed, canInstall: state.canInstall, install, ios };
}

function Settings({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  const { installed, canInstall, install, ios } = useInstall();
  const [scale, setScale] = useState(1);
  useEffect(() => setScale(currentFontScale()), []);

  const [alerts, setAlerts] = useState<AlertState>("off");
  const [alertBusy, setAlertBusy] = useState(false);
  useEffect(() => {
    alertsState().then(setAlerts);
  }, []);
  const turnOnAlerts = async () => {
    setAlertBusy(true);
    setAlerts(await enableAlerts());
    setAlertBusy(false);
  };

  const setSize = (s: number) => {
    setScale(s);
    saveFontScale(s);
  };

  const buildSha = process.env.NEXT_PUBLIC_BUILD_SHA || "local";
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || "";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-100">
      <div className="flex items-center justify-between border-b border-stone-200 bg-white p-3">
        <h3 className="text-sm font-bold uppercase tracking-widest">Settings</h3>
        <button
          onClick={onClose}
          className="rounded-full bg-[#1F4B45] px-4 py-2 text-xs font-bold uppercase tracking-wider text-stone-50"
        >
          Done
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* Install to device */}
        <Card title="This device">
          {installed ? (
            <p className="text-sm text-stone-700">
              <span className="font-bold text-[#1F4B45]">Installed ✓</span> — you&apos;re running the app from
              your home screen.
            </p>
          ) : canInstall ? (
            <>
              <p className="mb-3 text-sm text-stone-600">Add EEI Field Reports to this device as an app.</p>
              <button
                onClick={install}
                className="w-full rounded-lg bg-[#1F4B45] py-3 text-base font-bold uppercase tracking-wider text-stone-50"
              >
                Install app on this device
              </button>
            </>
          ) : ios ? (
            <div className="text-sm text-stone-700">
              <p className="mb-2">
                To add EEI Field Reports to your iPhone (Apple doesn&apos;t allow a one-tap button):
              </p>
              <ol className="ml-1 space-y-2">
                <li>
                  1. Tap the <span className="font-semibold">Share</span> button — the square with an arrow
                  pointing up{" "}
                  <span aria-hidden className="inline-block align-middle text-[#1F4B45]">⬆️</span> — at the
                  bottom of Safari.
                </li>
                <li>
                  2. Scroll down and tap <span className="font-semibold">Add to Home Screen</span>.
                </li>
                <li>
                  3. Tap <span className="font-semibold">Add</span> at the top right. The app icon lands on your
                  home screen.
                </li>
              </ol>
              <p className="mt-3 text-stone-500">
                Must be in <span className="font-semibold">Safari</span> (not Chrome) for this to appear. Once
                added, this box will say “Installed.”
              </p>
            </div>
          ) : (
            <div className="text-sm text-stone-700">
              <p className="mb-2">To add EEI Field Reports as an app on this phone:</p>
              <ol className="ml-1 space-y-2">
                <li>
                  1. Tap the <span className="font-semibold">⋮</span> menu at the top-right of Chrome.
                </li>
                <li>
                  2. Tap <span className="font-semibold">Install app</span> (or{" "}
                  <span className="font-semibold">Add to Home screen</span>).
                </li>
              </ol>
              <p className="mt-3 text-stone-500">
                If neither shows, reload this page once and reopen Settings — the one-tap button appears here
                as soon as the phone is ready.
              </p>
            </div>
          )}
        </Card>

        {/* Phone alerts */}
        <Card title="Alerts">
          {alerts === "on" ? (
            <p className="text-sm text-stone-700">
              <span className="font-bold text-[#1F4B45]">Alerts on ✓</span> — this phone will buzz you when an
              elevator needs your hands (record a PO, chase maintenance, do an inspection, send an invoice,
              record payment). Checked every hour, 8am–7pm.
            </p>
          ) : alerts === "blocked" ? (
            <p className="text-sm text-stone-700">
              Alerts are blocked for this site in your phone&apos;s settings. Turn notifications back on for
              eeireports.sbs, then come back here.
            </p>
          ) : alerts === "unsupported" ? (
            <p className="text-sm text-stone-700">
              This browser can&apos;t do phone alerts. On iPhone, first add the app to your home screen (above),
              open it from there, then turn alerts on.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-stone-600">
                Get a buzz on this phone when something needs you — even when the app is closed.
              </p>
              <button
                onClick={turnOnAlerts}
                disabled={alertBusy}
                className="w-full rounded-lg bg-[#1F4B45] py-3 text-base font-bold uppercase tracking-wider text-stone-50 disabled:opacity-60"
              >
                {alertBusy ? "Turning on…" : "Turn on alerts for this phone"}
              </button>
            </>
          )}
        </Card>

        {/* Text size */}
        <Card title="Text size">
          <p className="mb-3 text-sm text-stone-600">Make everything bigger for easier reading.</p>
          <div className="flex flex-wrap gap-2">
            {FONT_SCALES.map((s) => {
              const on = s === scale;
              return (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className={
                    "rounded-full border px-4 py-2 text-sm font-semibold " +
                    (on
                      ? "border-[#1F4B45] bg-[#1F4B45] text-stone-50"
                      : "border-stone-300 bg-stone-50 text-stone-700")
                  }
                >
                  {FONT_SCALE_LABELS[s]}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Account */}
        <Card title="Account">
          <button
            onClick={onLogout}
            className="w-full rounded-lg border border-stone-300 bg-stone-50 py-3 text-sm font-bold uppercase tracking-wider text-stone-700 active:bg-stone-200"
          >
            Log out
          </button>
        </Card>

        {/* Build */}
        <Card title="Version">
          <dl className="divide-y divide-stone-100 text-sm">
            <div className="flex justify-between py-2">
              <dt className="text-stone-500">Build</dt>
              <dd className="font-mono text-stone-700">{buildSha}</dd>
            </div>
            {buildTime && (
              <div className="flex justify-between py-2">
                <dt className="text-stone-500">Deployed</dt>
                <dd className="text-stone-700">{new Date(buildTime).toLocaleString()}</dd>
              </div>
            )}
          </dl>
          <p className="mt-2 text-xs text-stone-400">
            Full history of every build lives in the project&apos;s Vercel dashboard.
          </p>
        </Card>
      </div>
    </div>
  );
}

/* ---------- shared bits ---------- */

function dueTone(days: number | null): string {
  if (days === null) return "border-stone-300 bg-stone-50 text-stone-600";
  if (days < 0) return "border-red-300 bg-red-50 text-red-700";
  if (days <= 30) return "border-amber-300 bg-amber-50 text-amber-700";
  if (days <= DUE_SOON_DAYS) return "border-[#1F4B45]/40 bg-[#DDE8E4] text-[#1F4B45]";
  return "border-stone-300 bg-stone-50 text-stone-600";
}
function DueBadge({ due }: { due: string }) {
  const d = daysUntil(due);
  const label =
    d === null ? due || "no date" : d < 0 ? `${-d}d overdue` : d === 0 ? "due today" : `due in ${d}d`;
  return (
    <span
      className={
        "inline-block shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider " +
        dueTone(d)
      }
    >
      {label}
    </span>
  );
}
function UnitRow({ u, onPick, showAccount }: { u: Elevator; onPick: (e: Elevator) => void; showAccount?: boolean }) {
  return (
    <button
      onClick={() => onPick(u)}
      className="w-full rounded-lg border border-stone-300 bg-white p-3 text-left active:bg-stone-100"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold">{u.building}</div>
        <DueBadge due={u.due} />
      </div>
      <div className="mt-0.5 text-xs text-stone-500">
        {[u.city, u.type, showAccount ? u.account : ""].filter(Boolean).join(" · ")}
      </div>
      <div className="mt-1 font-mono text-xs font-medium text-[#1F4B45]">#{u.okla} · due {u.due || "—"}</div>
    </button>
  );
}

/* ---------- screens ---------- */

function Picker({
  onPick,
  onNew,
  onSettings,
}: {
  onPick: (e: Elevator) => void;
  onNew: () => void;
  onSettings: () => void;
}) {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"all" | "soon">("all");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "live" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const query = q.trim().toLowerCase();

  // Live dashboard only — no sample data. If it can't load, show why + Retry.
  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    (async () => {
      try {
        const res = await fetch("/api/roster");
        const data = (await res.json()) as { accounts?: Account[]; error?: string };
        if (!res.ok || !data.accounts) throw new Error(data.error || `Error ${res.status}`);
        if (!cancelled) {
          setAccounts(data.accounts);
          setLoadState("live");
        }
      } catch (e) {
        if (!cancelled) {
          setAccounts([]);
          setErrMsg(e instanceof Error ? e.message : "Couldn't reach the dashboard");
          setLoadState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const matches = (u: Elevator, accountName: string) =>
    !query ||
    u.building.toLowerCase().includes(query) ||
    u.okla.includes(query) ||
    accountName.toLowerCase().includes(query);
  const byDue = (a: Elevator, b: Elevator) => {
    const da = daysUntil(a.due), db = daysUntil(b.due);
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  };

  // "All" = grouped by account, each account's units soonest-due first.
  const grouped = useMemo(
    () =>
      accounts
        .map((a) => ({ ...a, units: a.units.filter((u) => matches(u, a.name)).sort(byDue) }))
        .filter((a) => a.units.length > 0),
    [accounts, query],
  );
  // "Due soon" = one flat list across all accounts, within the window, soonest first.
  const dueSoon = useMemo(() => {
    const all: Elevator[] = [];
    for (const a of accounts) for (const u of a.units) if (matches(u, a.name)) all.push(u);
    return all
      .filter((u) => {
        const d = daysUntil(u.due);
        return d !== null && d <= DUE_SOON_DAYS;
      })
      .sort(byDue);
  }, [accounts, query]);

  return (
    <div className="mx-auto max-w-md px-4 pb-16 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-extrabold tracking-wide text-[#1F4B45]">ELITE / FIELD</div>
        <button onClick={onSettings} className="text-xs font-semibold uppercase tracking-wider text-stone-500">
          ⚙ Settings
        </button>
      </div>
      <h1 className="mb-3 text-lg font-bold">Elevators</h1>

      {/* All vs Due soon */}
      <div className="mb-3 flex gap-2">
        {(["all", "soon"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={
              "flex-1 rounded-lg border py-2 text-sm font-bold uppercase tracking-wider " +
              (mode === m
                ? "border-[#1F4B45] bg-[#1F4B45] text-stone-50"
                : "border-stone-300 bg-stone-50 text-stone-600")
            }
          >
            {m === "all" ? "All" : "Due soon"}
          </button>
        ))}
      </div>

      <input
        className={inputCls + " mb-3"}
        placeholder="Search building, account, or Oklahoma number"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <button
        onClick={onNew}
        className="mb-4 w-full rounded-lg border-2 border-dashed border-[#1F4B45] py-3 text-sm font-bold uppercase tracking-wider text-[#1F4B45] active:bg-[#DDE8E4]"
      >
        + New elevator
      </button>

      {loadState === "loading" && <p className="px-1 text-sm text-stone-500">Loading your list…</p>}

      {loadState === "live" && mode === "all" && (
        <>
          {grouped.map((a) => (
            <div key={a.name} className="mb-4">
              <div className="mb-1 px-1 text-xs font-bold uppercase tracking-wider text-stone-500">{a.name}</div>
              <div className="flex flex-col gap-2">
                {a.units.map((u) => (
                  <UnitRow key={u.okla} u={u} onPick={onPick} />
                ))}
              </div>
            </div>
          ))}
          {grouped.length === 0 && <p className="px-1 text-sm text-stone-500">No matches.</p>}
        </>
      )}

      {loadState === "live" && mode === "soon" && (
        <>
          <div className="mb-1 px-1 text-xs font-bold uppercase tracking-wider text-stone-500">
            Due within {DUE_SOON_DAYS} days
          </div>
          <div className="flex flex-col gap-2">
            {dueSoon.map((u) => (
              <UnitRow key={u.okla} u={u} onPick={onPick} showAccount />
            ))}
          </div>
          {dueSoon.length === 0 && (
            <p className="px-1 text-sm text-stone-500">Nothing due in the next {DUE_SOON_DAYS} days.</p>
          )}
        </>
      )}

      {loadState === "error" && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-700">Couldn&apos;t load your elevator list.</p>
          <p className="mt-1 text-xs text-red-600">{errMsg}</p>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-3 rounded-lg bg-[#1F4B45] px-4 py-2 text-sm font-bold text-stone-50"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

const NEW_TYPES = [
  "Elevator (Traction)",
  "Elevator (Hydraulic)",
  "Escalator",
  "Moving Walk",
  "Wheelchair/Platform Lift",
];
const MONEY_PATHS = ["Quote to PO to invoice", "Invoice only"];
// Labels must match the fillForm maps exactly (they key the PDF fields).
const DEVICE_TYPES = ["Const/Temp", "Escalator/MW", "Personnel Hoist", "Platform Lift", "Stairway Chair Lift", "Passenger", "LU/LA", "Freight"];
const MACHINE_TYPES = ["Cable", "Direct Plunger Hydraulic", "Hand Powered", "Roped Hydraulic", "Other"];
const ENTITY_TYPES = ["Private", "County", "City", "State"];

type NewForm = {
  // dashboard row (cols A..R)
  okla: string; building: string; account: string; type: string; floors: string; cycle: string; due: string;
  city: string; area: string; contact: string; email: string; phone: string;
  maintCo: string; maintContact: string; maintEmail: string; maintPhone: string;
  price: string; moneyPath: string;
  // technical details for the PDF (no prior report to carry from)
  serial: string; permit: string; mfr: string; capacity: string; speed: string; rise: string;
  openings: string; landings: string; installed: string; codeYear: string;
  deviceType: string; machineType: string; entityType: string;
  owner: string; ownerAddr: string; locAddr: string;
};
const BLANK_FORM: NewForm = {
  okla: "", building: "", account: "", type: "", floors: "", cycle: "", due: "",
  city: "", area: "", contact: "", email: "", phone: "",
  maintCo: "", maintContact: "", maintEmail: "", maintPhone: "", price: "", moneyPath: "",
  serial: "", permit: "", mfr: "", capacity: "", speed: "", rise: "",
  openings: "", landings: "", installed: "", codeYear: "",
  deviceType: "", machineType: "", entityType: "", owner: "", ownerAddr: "", locAddr: "",
};

// Build the carried (technical) field list the PDF filler expects.
function carriedFromForm(f: NewForm): { label: string; value: string }[] {
  return [
    ["Serial number", f.serial], ["Permit #", f.permit], ["Manufacturer", f.mfr],
    ["Capacity (lbs)", f.capacity], ["Speed (FPM)", f.speed], ["Rise", f.rise],
    ["Openings", f.openings], ["# of landings", f.landings], ["Device type", f.deviceType],
    ["Installed year", f.installed], ["Code year", f.codeYear], ["Machine type", f.machineType],
    ["Entity type", f.entityType], ["Owner", f.owner], ["Owner address", f.ownerAddr],
    ["Location address", f.locAddr],
  ].map(([label, value]) => ({ label, value }));
}

// Module-level so it isn't recreated each render (which would drop input focus).
function TextRow({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <Field label={label}>
      <input className={inputCls} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function NewElevator({ onBack, onCreated }: { onBack: () => void; onCreated: (e: Elevator) => void }) {
  const [f, setF] = useState<NewForm>(BLANK_FORM);
  const [annual, setAnnual] = useState(false); // hospital/nursing-home/mobility exception
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = <K extends keyof NewForm>(k: K, v: string) => setF((p) => ({ ...p, [k]: v }));
  const ready = f.okla.trim() && f.building.trim() && f.account.trim();
  const cycle = computeCycle(f.type, annual);

  async function create() {
    if (!ready) {
      setErr("Oklahoma #, Building, and Account are required.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const floors = parseInt(f.floors, 10) || 0;
      const priceNum = computePrice(f.type, floors);
      const payload = { ...f, cycle, price: priceNum == null ? "" : `$${priceNum}` };
      const res = await fetch("/api/elevators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; row?: number };
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      // Hand the new elevator (with technical details + its sheet row) to the
      // first inspection, so the first PDF gets everything.
      const cycleNum = cycle.match(/\d/)?.[0] || "1";
      const elevator: Elevator = {
        okla: f.okla.trim(),
        building: f.building.trim(),
        account: f.account.trim(),
        contact: f.contact,
        area: f.area,
        city: f.city,
        type: f.type,
        floors: parseInt(f.floors, 10) || 0,
        cycle: cycleNum,
        due: f.due,
        row: data.row ?? undefined,
        lifecycle: [],
        carried: carriedFromForm(f),
        lastYear: { date: "", inspType: "Initial", test1: "", test5: "", certIssue: "Yes", condition: "No adverse conditions", notes: "" },
      };
      onCreated(elevator);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} className="text-xs font-semibold text-stone-600">‹ List</button>
        <div className="grow" />
      </div>
      <h1 className="mb-3 text-lg font-bold">New elevator</h1>

      <Card title="Identity">
        <TextRow label="Oklahoma # (required)" value={f.okla} onChange={(v) => set("okla", v)} />
        <TextRow label="Building (required)" value={f.building} onChange={(v) => set("building", v)} />
        <TextRow label="Account (required)" value={f.account} onChange={(v) => set("account", v)} />
        <Field label="Type">
          <Chips options={NEW_TYPES} value={f.type} onChange={(v) => set("type", v)} />
        </Field>
        <TextRow label="Floors" value={f.floors} onChange={(v) => set("floors", v)} type="number" />
        <Field label="Inspection cycle (auto)">
          <div className="flex items-center justify-between rounded-lg border border-stone-300 bg-stone-50 px-3 py-2.5">
            <span className="text-base font-semibold">{cycle}</span>
            <span className="text-xs text-stone-400">{annual ? "annual exception" : "from type"}</span>
          </div>
        </Field>
        <label className="mb-3 flex items-start gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={annual}
            onChange={(e) => setAnnual(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>Hospital, nursing home, or mobility-restricted facility (inspect annually regardless of type)</span>
        </label>
        <TextRow label="Next due date" value={f.due} onChange={(v) => set("due", v)} type="date" />
      </Card>

      <Card title="Technical details (for the PDF)">
        <div className="grid grid-cols-2 gap-3">
          <TextRow label="Serial number" value={f.serial} onChange={(v) => set("serial", v)} />
          <TextRow label="Permit #" value={f.permit} onChange={(v) => set("permit", v)} />
        </div>
        <TextRow label="Manufacturer" value={f.mfr} onChange={(v) => set("mfr", v)} />
        <div className="grid grid-cols-2 gap-3">
          <TextRow label="Capacity (lbs)" value={f.capacity} onChange={(v) => set("capacity", v)} />
          <TextRow label="Speed (FPM)" value={f.speed} onChange={(v) => set("speed", v)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextRow label="Rise" value={f.rise} onChange={(v) => set("rise", v)} />
          <TextRow label="Openings" value={f.openings} onChange={(v) => set("openings", v)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextRow label="# of landings" value={f.landings} onChange={(v) => set("landings", v)} />
          <TextRow label="Installed year" value={f.installed} onChange={(v) => set("installed", v)} />
        </div>
        <TextRow label="Code year" value={f.codeYear} onChange={(v) => set("codeYear", v)} />
        <Field label="Device type">
          <Chips options={DEVICE_TYPES} value={f.deviceType} onChange={(v) => set("deviceType", v)} />
        </Field>
        <Field label="Machine type">
          <Chips options={MACHINE_TYPES} value={f.machineType} onChange={(v) => set("machineType", v)} />
        </Field>
        <Field label="Entity type">
          <Chips options={ENTITY_TYPES} value={f.entityType} onChange={(v) => set("entityType", v)} />
        </Field>
        <TextRow label="Owner" value={f.owner} onChange={(v) => set("owner", v)} />
        <TextRow label="Owner address" value={f.ownerAddr} onChange={(v) => set("ownerAddr", v)} />
        <TextRow label="Location address" value={f.locAddr} onChange={(v) => set("locAddr", v)} />
      </Card>

      <Card title="Location & contact">
        <div className="grid grid-cols-2 gap-3">
          <TextRow label="City" value={f.city} onChange={(v) => set("city", v)} />
          <TextRow label="Area" value={f.area} onChange={(v) => set("area", v)} />
        </div>
        <TextRow label="Contact name" value={f.contact} onChange={(v) => set("contact", v)} />
        <TextRow label="Customer email" value={f.email} onChange={(v) => set("email", v)} type="email" />
        <TextRow label="Customer phone" value={f.phone} onChange={(v) => set("phone", v)} />
      </Card>

      <Card title="Maintenance company">
        <TextRow label="Company" value={f.maintCo} onChange={(v) => set("maintCo", v)} />
        <TextRow label="Contact" value={f.maintContact} onChange={(v) => set("maintContact", v)} />
        <TextRow label="Email" value={f.maintEmail} onChange={(v) => set("maintEmail", v)} type="email" />
        <TextRow label="Phone" value={f.maintPhone} onChange={(v) => set("maintPhone", v)} />
      </Card>

      <Card title="Billing">
        <div className="mb-3 flex items-center justify-between rounded-lg bg-stone-800 px-4 py-3 text-stone-100">
          <span className="text-xs font-bold uppercase tracking-wider text-stone-400">Price (auto)</span>
          <span className="font-mono text-xl font-medium">{formatPrice(computePrice(f.type, parseInt(f.floors, 10) || 0))}</span>
        </div>
        {computePrice(f.type, parseInt(f.floors, 10) || 0) == null && (
          <p className="mb-3 text-xs text-amber-700">Pick a Type (and Floors, for elevators) above to price it.</p>
        )}
        <Field label="Money path">
          <Chips options={MONEY_PATHS} value={f.moneyPath} onChange={(v) => set("moneyPath", v)} />
        </Field>
      </Card>

      {err && <p className="mb-3 px-1 text-sm font-semibold text-red-600">{err}</p>}

      <button
        onClick={create}
        disabled={busy}
        className="w-full rounded-lg bg-[#1F4B45] py-3 text-sm font-bold uppercase tracking-wider text-stone-50 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save & start first inspection"}
      </button>
      <p className="mt-3 px-1 text-xs text-stone-400">
        Adds the elevator to your dashboard, then opens its first inspection (date, condition, violations) so its
        first PDF is saved to Drive — a new account gets its own Drive folder automatically.
      </p>
    </div>
  );
}

function LifecycleEditor({
  stage,
  row,
  onClose,
  onSaved,
}: {
  stage: LifecycleStage;
  row?: number;
  onClose: () => void;
  onSaved: (value: string) => void;
}) {
  const [choice, setChoice] = useState(stage.value);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const changed = choice !== stage.value;
  const show = (v: string) => (v ? `“${v}”` : "blank");

  async function save() {
    if (row == null) {
      setErr("This elevator has no saved row yet — can't write.");
      setConfirm(false);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row, col: stage.col, value: choice }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || `Error ${res.status}`);
      }
      onSaved(choice);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-100">
      <div className="flex items-center justify-between border-b border-stone-200 bg-white p-3">
        <h3 className="text-sm font-bold uppercase tracking-widest">{stage.label}</h3>
        <button onClick={onClose} className="text-xs font-semibold uppercase tracking-wider text-stone-500">
          Cancel
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <Card title="Set status">
          {stage.options.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {stage.options.map((o) => {
                const on = o === choice;
                return (
                  <button
                    key={o}
                    onClick={() => setChoice(o)}
                    className={
                      "rounded-full border px-4 py-2 text-sm font-semibold " +
                      (on ? "border-[#1F4B45] bg-[#1F4B45] text-stone-50" : "border-stone-300 bg-stone-50 text-stone-700")
                    }
                  >
                    {o}
                  </button>
                );
              })}
            </div>
          ) : (
            <input
              className={inputCls}
              placeholder="Type a value"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
            />
          )}
          <button
            onClick={() => setChoice("")}
            className="mt-3 text-xs font-semibold uppercase tracking-wider text-stone-500"
          >
            Clear this step
          </button>
          {err && <p className="mt-3 text-sm font-semibold text-red-600">{err}</p>}
        </Card>
      </div>

      <div className="border-t border-stone-200 bg-white p-4">
        <button
          onClick={() => setConfirm(true)}
          disabled={!changed || busy}
          className="w-full rounded-lg bg-[#1F4B45] py-3 text-sm font-bold uppercase tracking-wider text-stone-50 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      {/* double-confirm before any write */}
      {confirm && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h4 className="text-base font-bold">Are you sure?</h4>
            <p className="mt-2 text-sm text-stone-600">
              Set <span className="font-semibold">{stage.label}</span> to{" "}
              <span className="font-semibold">{show(choice)}</span> on the live dashboard?
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setConfirm(false)}
                disabled={busy}
                className="flex-1 rounded-lg border border-stone-300 bg-stone-50 py-3 text-sm font-bold uppercase tracking-wider text-stone-700"
              >
                No, cancel
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="flex-1 rounded-lg bg-[#1F4B45] py-3 text-sm font-bold uppercase tracking-wider text-stone-50 disabled:opacity-60"
              >
                {busy ? "Saving…" : "Yes, save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Profile({
  elevator,
  onBack,
  onStartReport,
  onSettings,
}: {
  elevator: Elevator;
  onBack: () => void;
  onStartReport: () => void;
  onSettings: () => void;
}) {
  const e = elevator;
  const [lifecycle, setLifecycle] = useState<LifecycleStage[]>(elevator.lifecycle);
  const [editing, setEditing] = useState<LifecycleStage | null>(null);
  const details: [string, string][] = [
    ["Account", e.account],
    ["Contact", e.contact],
    ["City", e.city],
    ["Area", e.area],
    ["Type", e.type],
    ["Floors", e.floors ? String(e.floors) : "—"],
    ["Cycle", e.cycle === "Res" ? "Residential" : `${e.cycle} year`],
    ["Price", e.price || formatPrice(computePrice(e.type, e.floors))],
    ["Money path", e.moneyPath || "—"],
  ];
  return (
    <div className="mx-auto max-w-md px-4 pb-24 pt-4">
      {editing && (
        <LifecycleEditor
          stage={editing}
          row={e.row}
          onClose={() => setEditing(null)}
          onSaved={(value) => {
            setLifecycle((prev) => prev.map((s) => (s.key === editing.key ? { ...s, value } : s)));
            setEditing(null);
          }}
        />
      )}
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} className="text-xs font-semibold text-stone-600">‹ List</button>
        <div className="grow" />
        <button onClick={onSettings} className="text-xs font-semibold uppercase tracking-wider text-stone-500">
          ⚙ Settings
        </button>
      </div>

      {/* data plate */}
      <div className="mb-3 rounded-lg bg-stone-800 p-4 text-stone-100">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">Oklahoma #</div>
        <div className="font-mono text-2xl font-medium">{e.okla}</div>
        <div className="mt-1 text-sm font-semibold">{e.building}</div>
        <div className="mt-2 flex items-center gap-2">
          <DueBadge due={e.due} />
          <span className="text-xs text-stone-400">due {e.due || "—"}</span>
        </div>
      </div>

      {/* primary actions */}
      <div className="mb-3 grid grid-cols-1 gap-2">
        <button
          onClick={onStartReport}
          className="rounded-lg bg-[#1F4B45] py-3 text-sm font-bold uppercase tracking-wider text-stone-50 active:opacity-90"
        >
          Start inspection report
        </button>
      </div>

      {/* lifecycle — tap any step to change it (writes to the dashboard after a confirm) */}
      <Card title="Customer lifecycle">
        <div className="flex flex-col gap-1.5">
          {lifecycle.map((s) => (
            <button
              key={s.key}
              onClick={() => setEditing(s)}
              className="flex items-center justify-between gap-3 rounded-md bg-stone-50 px-3 py-2 text-left active:bg-stone-200"
            >
              <span className="text-sm text-stone-600">{s.label}</span>
              <span className="flex items-center gap-2">
                {s.value ? (
                  <span className="rounded-full bg-[#DDE8E4] px-2 py-0.5 text-xs font-semibold text-[#1F4B45]">
                    {s.value}
                  </span>
                ) : (
                  <span className="text-xs text-stone-400">—</span>
                )}
                <span className="text-stone-300">›</span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-stone-400">Tap a step to change it — you&apos;ll confirm before it saves.</p>
      </Card>

      {/* details */}
      <Card title="Details">
        <dl className="divide-y divide-stone-100">
          {details.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2">
              <dt className="text-xs font-semibold uppercase tracking-wider text-stone-500">{k}</dt>
              <dd className="text-right text-sm text-stone-700">{v || "—"}</dd>
            </div>
          ))}
        </dl>
      </Card>
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
  onBack,
  onSettings,
}: {
  elevator: Elevator;
  onBack: () => void;
  onSettings: () => void;
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
          <button onClick={onBack} className="text-xs font-semibold text-stone-600">
            ‹ Profile
          </button>
          <button onClick={onSettings} className="text-xs font-semibold text-stone-500">
            ⚙ Settings
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
  const [stage, setStage] = useState<Stage>("list");
  const [selected, setSelected] = useState<Elevator | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const logout = () => signOut({ redirectUrl: "/sign-in" });
  const openSettings = () => setSettingsOpen(true);

  return (
    <>
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} onLogout={logout} />}
      {stage === "new" ? (
        <NewElevator
          onBack={() => setStage("list")}
          onCreated={(e) => {
            setSelected(e);
            setStage("report");
          }}
        />
      ) : stage === "list" || !selected ? (
        <Picker
          onPick={(e) => {
            setSelected(e);
            setStage("profile");
          }}
          onNew={() => setStage("new")}
          onSettings={openSettings}
        />
      ) : stage === "profile" ? (
        <Profile
          key={selected.okla}
          elevator={selected}
          onBack={() => setStage("list")}
          onStartReport={() => setStage("report")}
          onSettings={openSettings}
        />
      ) : (
        <Report
          key={selected.okla}
          elevator={selected}
          onBack={() => setStage("profile")}
          onSettings={openSettings}
        />
      )}
    </>
  );
}
