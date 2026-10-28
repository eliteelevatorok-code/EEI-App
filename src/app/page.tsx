"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { getRoster, getServerRoster, patchElevator, refreshRoster, subscribeRoster } from "@/lib/roster-store";
import { useClerk } from "@clerk/nextjs";
import { call, postJson } from "@/lib/net";
import { getInstallState, subscribeInstall, triggerInstall } from "@/lib/pwa-install";
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
} from "@/lib/data";
import { VHEAD, VIOLATIONS, parseViolation } from "@/lib/violations";
import { FONT_SCALES, FONT_SCALE_LABELS, currentFontScale, saveFontScale } from "@/lib/prefs";
import { computeCycle, computePrice, formatPrice } from "@/lib/pricing";
import { DEVICE_TYPE_CODE, ENTITY_TYPE_CODE, MACHINE_TYPE_CODE } from "@/lib/formCodes";
import { inspectionBlocked } from "@/lib/inOrder";
import { FORM_BASICS, TECH, TECH_KEYS, missingForForm, type BasicKey, type TechKey, type TechKind } from "@/lib/tech";
import { DASHBOARD_URL } from "@/lib/dashboard";
import {
  FAST_MIN_LEAD_MS,
  upToQuarterHour,
  FAST_ORDER,
  FAST_STEPS,
  fastCancelSet,
  fastStepForStage,
  fastWindow,
  nextFastStep,
  type FastInputs,
  type FastStepKey,
  type FastTimes,
} from "@/lib/fasttrack";
import { APRIL, WHERE_TO_FIND, checkSafetyDate, isAmerican, isoToday, toIsoDate } from "@/lib/records";
import { formLines } from "@/lib/formLines";
import { monthYearProblem, noCertificate, noDueDate, typeMonthYear } from "@/lib/reportRules";
import { AssistantButton } from "@/components/Assistant";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Button,
  CheckIcon,
  Chips,
  DueDot,
  ElevatorsIcon,
  Field,
  Glass,
  InfoRow,
  List,
  MoneyIcon,
  Pill,
  PlusIcon,
  Screen,
  SearchIcon,
  SectionLabel,
  Segmented,
  SettingsIcon,
  Sheet,
  TabBar,
  Title,
  TodayIcon,
  Toggle,
  TopBar,
  buzz,
  go,
  ReloadIcon,
} from "@/components/ui";

// All styling comes from the style guide (src/app/globals.css) and the pieces in
// src/components/ui.tsx — no raw colors or one-off looks in this file.

// The four places in the tab bar, and the screens opened on top of them.
type Tab = "today" | "elevators" | "money" | "settings";
type Stage = "tabs" | "profile" | "report" | "new";

// The elevator list, shared by every tab: shown instantly from the phone's saved
// copy, refreshed from the dashboard when the app opens or comes back to front.
function useRoster() {
  const roster = useSyncExternalStore(subscribeRoster, getRoster, getServerRoster);
  useEffect(() => {
    void refreshRoster();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshRoster();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return roster;
}

// One lifecycle cell's value on an elevator (e.g. stage(e, "visit") → "Booked").
const stage = (e: Elevator, key: string) => e.lifecycle.find((s) => s.key === key)?.value ?? "";
// Why this elevator's inspection can't start yet (a step before it isn't done), or null.
const inspectWhy = (e: Elevator) =>
  inspectionBlocked({
    moneyPath: e.moneyPath,
    twoMoEmail: stage(e, "twoMoEmail"),
    quote: stage(e, "quote"),
    po: stage(e, "po"),
    maintConfirm: stage(e, "maintConfirm"),
    scheduling: stage(e, "scheduling"),
    visit: stage(e, "visit"),
    report: stage(e, "report"),
  });

// "$1,175.50" → 1175.5; falls back to the rate card when the cell is empty.
function priceOf(e: Elevator): number {
  const n = Number((e.price ?? "").replace(/[^0-9.]/g, ""));
  return n > 0 ? n : (computePrice(e.type, e.floors) ?? 0);
}
// The price actually on the dashboard (what the quote email and invoice use) — no rate-card fallback.
const hasSheetPrice = (e: Elevator) => Number((e.price ?? "").replace(/[^0-9.]/g, "")) > 0;
const money = (n: number) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });

// Shown by a tab while the list hasn't arrived yet, or if it can't be reached.
function RosterStatus({ error }: { error: string }) {
  const [trying, setTrying] = useState(false);
  if (!error) return <p className="mt-10 text-center text-sm text-ink-3">Loading your list…</p>;
  const retry = async () => {
    setTrying(true);
    await refreshRoster();
    setTrying(false);
  };
  return (
    <Glass pad className="mt-6">
      <p className="font-semibold text-danger">Couldn&apos;t load your elevator list.</p>
      <p className="mt-1 text-sm text-ink-2">{trying ? "Trying again…" : error}</p>
      <Button className="mt-4" onClick={retry} disabled={trying}>
        {trying ? "Trying…" : "Try again"}
      </Button>
    </Glass>
  );
}

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

// "10/3/2026" → "Saturday, October 3" (year added if it isn't this year). Used
// wherever the app talks to you about a date, so it reads like a person wrote it.
function humanDate(s: string): string {
  const d = parseDue(s);
  if (!d) return s;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

// The report being filled in on the phone (becomes the PDF on "Finish report").
type ReportDraft = {
  date: string;
  inspType: string;
  cycle: string;
  test1: string;
  test5: string;
  certIssue: string;
  tempCert?: string; // "No" | "30 days" | "60 days" (older drafts don't have it)
  condition: string;
  notes: string;
  added: AddedViolation[]; // violations from the list, each with an optional comment
  recommendations?: string[]; // typed (older drafts don't have these)
  comments?: string[];
};
const TEMP_CERT = ["No", "30 days", "60 days"];

// "Save for later" keeps the draft on this phone under this key, one per elevator.
const draftKey = (okla: string) => `eei_draft_${okla}`;

// Read a saved draft back, or null if there isn't a usable one.
function loadDraft(okla: string): ReportDraft | null {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(okla)) || "null") as ReportDraft | null;
    if (!d || !Array.isArray(d.added)) return null;
    // Older drafts could mark a list item as a recommendation or comment — those
    // become typed recommendations / comments now.
    const words = (a: AddedViolation) => [a.violation, a.comment].filter((x) => x?.trim()).join(" — ");
    return {
      ...d,
      added: d.added.filter((a) => a.kind === "V"),
      recommendations: [...(d.recommendations ?? []), ...d.added.filter((a) => a.kind === "R").map(words)],
      comments: [...(d.comments ?? []), ...d.added.filter((a) => a.kind === "C").map(words)],
    };
  } catch {
    return null;
  }
}

// A new, empty report — pre-filled with what we know from last time.
function freshReport(e: Elevator): ReportDraft {
  return {
    date: "",
    inspType: e.lastYear.inspType,
    cycle: e.cycle,
    test1: e.lastYear.test1,
    test5: e.lastYear.test5,
    certIssue: e.lastYear.certIssue,
    tempCert: "No",
    condition: e.lastYear.condition,
    notes: "",
    added: [],
    recommendations: [],
    comments: [],
  };
}

/* ---------- settings ---------- */

// Reads the app-wide install state captured at startup (see lib/pwa-install).
// Because the browser's install event is captured on load — not when this sheet
// opens — the button is available here even though the event fired earlier.
// (Settings only ever opens after a tap, so reading browser-only state up front is safe.)
function useInstall() {
  const [state, setState] = useState(getInstallState);
  useEffect(() => subscribeInstall(() => setState(getInstallState())), []);
  const [installMsg, setInstallMsg] = useState("");
  const install = () => {
    setInstallMsg("");
    triggerInstall()
      .then((ok) => setInstallMsg(ok ? "" : "Not installed. Chrome will offer it again next time you open the app."))
      .catch(() => setInstallMsg("Chrome couldn't open the install window. Use Chrome's ⋮ menu → Install app instead."));
  };
  return { installed: state.installed, canInstall: state.canInstall, install, installMsg };
}

// Settings → Calendly: is the booking page in the scheduling email offering
// times? If not, why (in plain words), and a "Fix Calendly" button for what the
// app can change — with "Are you sure?" listing exactly what changes
// (src/lib/calendlyCheck.ts).
type CalCheck = {
  connected: boolean;
  error?: string;
  link?: string;
  weekly?: string[];
  hoursZone?: string;
  openTimes?: number;
  openDays?: number;
  firstOpen?: string;
  problems: string[];
  fixes: string[];
};
function CalendlyCard() {
  const [c, setC] = useState<CalCheck | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    call("/api/calendly")
      .then((r) => (r.ok ? r.json() : null))
      .then(setC)
      .catch(() => setC(null));
  }, []);
  async function fix() {
    setBusy(true);
    setErr("");
    try {
      const d = await postJson<{ check?: CalCheck }>("/api/calendly", { fix: true });
      if (!d.check) throw new Error("Calendly didn't answer — try again.");
      buzz();
      setC(d.check);
      setSure(false);
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Fix failed");
    } finally {
      setBusy(false);
    }
  }
  if (!c) return null;
  const good = c.connected && !c.problems.length;
  return (
    <>
      <SectionLabel>Calendly</SectionLabel>
      <Glass pad>
        <div className="flex items-center justify-between">
          <span className="text-[15px]">Booking page</span>
          <Pill tone={good ? "green" : "red"} dot>
            {!c.connected ? "Not connected" : c.openTimes ? "Offering days" : "No open days"}
          </Pill>
        </div>
        {c.error && <p className="mt-2 text-sm text-danger">{c.error}</p>}
        {c.connected && (
          <p className="mt-2 text-sm text-ink-3">
            {c.openTimes
              ? `${c.openDays ?? c.openTimes} open days in the next 4 weeks${c.firstOpen ? ` — first ${dayOf(c.firstOpen)}` : ""}.`
              : "Customers see “No openings at the moment.”"}{" "}
            Hours: {c.weekly?.length ? c.weekly.join(" · ") : "none set"}
            {c.hoursZone ? ` (${c.hoursZone} time)` : ""}.
          </p>
        )}
        {c.problems.length > 0 && (
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[15px] text-ink-2">
            {c.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {c.fixes.length > 0 &&
          (sure ? (
            <div className="mt-4">
              <p className="text-[15px] font-semibold">Are you sure? This changes Calendly:</p>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-[15px] text-ink-2">
                {c.fixes.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {err && <p className="mt-2 text-sm font-semibold text-danger">{err}</p>}
              <div className="mt-3 flex flex-col gap-2.5">
                <Button full onClick={fix} disabled={busy}>
                  {busy ? "Fixing…" : "Yes, fix it"}
                </Button>
                <Button variant="secondary" full onClick={() => setSure(false)} disabled={busy}>
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <Button full onClick={() => setSure(true)} className="mt-4">
              Fix Calendly
            </Button>
          ))}
        {c.link && (
          <a href={c.link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary mt-2.5 w-full">
            Open the booking page
          </a>
        )}
      </Glass>
    </>
  );
}

function SettingsTab({ onLogout }: { onLogout: () => Promise<void> }) {
  const [leaving, setLeaving] = useState(false);
  const { installed, canInstall, install, installMsg } = useInstall();
  const [scale, setScale] = useState(currentFontScale);

  // Live master-switch state, so the System card shows on/off at a glance.
  const master = useMasterOn();

  // Rule for this screen: a card appears only when it needs something from you.
  // Already installed / alerts already on / Drive already connected → nothing shown.

  // Can the app still save finished reports to Google Drive? (?drive=… is the
  // result of coming back from Google's sign-in page.) null = still checking.
  const [drive, setDrive] = useState<boolean | null>(null);
  const [driveResult] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("drive") || "",
  );
  useEffect(() => {
    call("/api/google/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { connected?: boolean } | null) => setDrive(d ? Boolean(d.connected) : null))
      .catch(() => setDrive(null));
  }, []);

  // Is billing on the real QuickBooks company yet? (?qb=… is the result of coming
  // back from Intuit's sign-in page.) null = still checking.
  // `reconnect`: QuickBooks stopped accepting the sign-in (expired, or
  // disconnected from the QuickBooks side) — "real" or "test" company.
  type QbState = { real: boolean; haveKeys: boolean; reconnect: "" | "real" | "test" };
  const [qb, setQb] = useState<QbState | null>(null);
  const [qbResult] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("qb") || "",
  );
  useEffect(() => {
    call("/api/quickbooks/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Partial<QbState> | null) =>
        setQb(d ? { real: Boolean(d.real), haveKeys: Boolean(d.haveKeys), reconnect: d.reconnect === "real" || d.reconnect === "test" ? d.reconnect : "" } : null),
      )
      .catch(() => setQb(null));
  }, []);

  // null = still checking (so nothing flashes up and disappears).
  const [alerts, setAlerts] = useState<AlertState | null>(null);
  const [alertBusy, setAlertBusy] = useState(false);
  const [alertMsg, setAlertMsg] = useState("");
  useEffect(() => {
    alertsState().then(setAlerts).catch(() => setAlerts("off"));
  }, []);
  const turnOnAlerts = async () => {
    setAlertBusy(true);
    setAlertMsg("");
    try {
      const next = await enableAlerts();
      setAlerts(next);
      if (next === "off") setAlertMsg("Alerts didn't turn on. Tap again, and choose Allow when your phone asks.");
    } catch (e) {
      setAlertMsg(e instanceof Error ? e.message : "Alerts didn't turn on — tap again.");
    } finally {
      setAlertBusy(false);
    }
  };

  const sizeLabels = FONT_SCALES.map((s) => FONT_SCALE_LABELS[s]);
  const setSize = (label: string) => {
    const s = FONT_SCALES.find((x) => FONT_SCALE_LABELS[x] === label) ?? 1;
    setScale(s);
    saveFontScale(s);
  };

  const buildSha = process.env.NEXT_PUBLIC_BUILD_SHA || "local";
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || "";

  return (
    <Screen bottomSpace>
      <Title eyebrow="This phone and the system">Settings</Title>

      {/* Only when Chrome has checked and says the app isn't on this phone yet. */}
      {canInstall && !installed && (
        <>
          <SectionLabel>This device</SectionLabel>
          <Glass pad>
            <p className="mb-3 text-[15px] text-ink-2">Add EEI Field Reports to this phone as an app.</p>
            <Button full onClick={install}>
              Install the app
            </Button>
          </Glass>
        </>
      )}
      {/* Outside the card: a dismissed install takes the card away with it. */}
      {installMsg && !installed && <p className="mt-2 px-1 text-sm font-semibold text-danger">{installMsg}</p>}

      {alerts && alerts !== "on" && (
        <>
          <SectionLabel>Alerts</SectionLabel>
          <Glass pad>
            {alerts === "blocked" ? (
              <p className="text-[15px] text-ink-2">
                Alerts are blocked for this site in your phone&apos;s settings. Turn notifications back on for
                eeireports.sbs, then come back here.
              </p>
            ) : alerts === "unsupported" ? (
              <p className="text-[15px] text-ink-2">
                This browser can&apos;t do phone alerts. Open the app in Chrome on your phone, then turn alerts on.
              </p>
            ) : (
              <>
                <p className="mb-3 text-[15px] text-ink-2">
                  Get a buzz on this phone when something needs you — even when the app is closed.
                </p>
                <Button full onClick={turnOnAlerts} disabled={alertBusy}>
                  {alertBusy ? "Turning on…" : "Turn on alerts"}
                </Button>
                {alertMsg && <p className="mt-2 text-sm font-semibold text-danger">{alertMsg}</p>}
              </>
            )}
          </Glass>
        </>
      )}

      {(drive === false || driveResult === "failed") && (
        <>
          <SectionLabel>Google Drive</SectionLabel>
          <Glass pad>
            <p className="mb-3 text-[15px] text-ink-2">
              {driveResult === "failed"
                ? "That didn't go through. Try again, and choose Allow on Google's page."
                : "Finished reports can't be saved to Drive or emailed until you sign in to Google again."}
            </p>
            {/* A full page visit (not a fetch): Google's sign-in page takes over, then comes back here. */}
            <a href="/api/google/connect" className="btn btn-primary w-full">
              Connect Google Drive
            </a>
          </Glass>
        </>
      )}

      {qb && (qb.reconnect || !qb.real) && (
        <>
          <SectionLabel>QuickBooks</SectionLabel>
          <Glass pad>
            <p className="mb-3 text-[15px] text-ink-2">
              {qbResult === "failed"
                ? "That didn't go through. Try again, and choose Connect on the QuickBooks page."
                : qb.reconnect
                  ? `QuickBooks stopped accepting the app's sign-in${qb.reconnect === "test" ? " for the test company" : ""}. Bills can't go out until you sign in again.`
                  : qb.haveKeys
                    ? "Bills still go to the QuickBooks test company. Connect your real QuickBooks to bill customers."
                    : "Bills still go to the QuickBooks test company. Your QuickBooks production keys need to be added to the dashboard's Config tab first."}
            </p>
            {/* A full page visit (not a fetch): Intuit's sign-in page takes over, then comes back here. */}
            {qb.reconnect ? (
              <a href={qb.reconnect === "test" ? "/api/quickbooks/connect?company=test" : "/api/quickbooks/connect"} className="btn btn-primary w-full">
                Reconnect QuickBooks
              </a>
            ) : (
              qb.haveKeys && (
                <a href="/api/quickbooks/connect" className="btn btn-primary w-full">
                  Connect QuickBooks
                </a>
              )
            )}
          </Glass>
        </>
      )}

      <CalendlyCard />

      <SectionLabel>Text size</SectionLabel>
      <Glass pad>
        <Chips options={sizeLabels} value={FONT_SCALE_LABELS[scale]} onChange={setSize} />
      </Glass>

      <SectionLabel>System</SectionLabel>
      <Glass pad>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[15px]">Whole system</span>
          {master === null ? (
            <span className="text-sm text-ink-3">Checking…</span>
          ) : (
            <Pill tone={master ? "green" : "red"} dot>
              {master ? "Running" : "Paused"}
            </Pill>
          )}
        </div>
        <Link href="/switches" className={"btn w-full " + (master === false ? "btn-primary" : "btn-secondary")}>
          {master === false ? "Resume the system" : "Master switch"}
        </Link>
        {/* The Google Sheet itself, opened outside the app (browser or Sheets app). */}
        <a href={DASHBOARD_URL} target="_blank" rel="noopener noreferrer" className="btn btn-secondary mt-2.5 w-full">
          Open the dashboard
        </a>
        <p className="mt-3 text-sm text-ink-3">Each elevator has its own switch on its profile.</p>
      </Glass>

      <SectionLabel>Account</SectionLabel>
      <Button
        variant="secondary"
        full
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          void onLogout();
        }}
      >
        {leaving ? "Logging out…" : "Log out"}
      </Button>

      <p className="mt-6 text-center text-xs text-ink-3">
        Build <span className="font-mono">{buildSha}</span>
        {buildTime && <> · {new Date(buildTime).toLocaleString()}</>}
      </p>
    </Screen>
  );
}

/* ---------- elevator list ---------- */

function UnitRow({ u, onPick, showAccount }: { u: Elevator; onPick: (e: Elevator) => void; showAccount?: boolean }) {
  return (
    <button onClick={() => onPick(u)} className="row" aria-label={[u.building, u.city, u.type].filter(Boolean).join(", ")}>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{u.building}</div>
        <div className="mt-0.5 truncate text-sm text-ink-2">
          {[u.city, u.type, showAccount ? u.account : ""].filter(Boolean).join(" · ")}
        </div>
      </div>
      <DueDot days={daysUntil(u.due)} fallback={u.due} />
    </button>
  );
}

// Today: what needs Robert right now, what's overdue, and what's coming up.
function TodayTab({ accounts, error, onPick }: { accounts: Account[] | null; error: string; onPick: (e: Elevator) => void }) {
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  if (!accounts) {
    return (
      <Screen bottomSpace>
        <Title eyebrow={today}>{hello}</Title>
        <RosterStatus error={error} />
      </Screen>
    );
  }
  const { needs, overdue, soon } = todayLists(accounts);

  return (
    <Screen bottomSpace>
      <Title eyebrow={today}>{hello}</Title>

      {needs.length + overdue.length === 0 && (
        <Glass pad className="mt-6 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent-ink">
            <TodayIcon />
          </div>
          <p className="mt-3 font-semibold">All clear</p>
          <p className="mt-1 text-sm text-ink-2">Nothing needs you right now. The automation is handling the rest.</p>
        </Glass>
      )}

      {needs.length > 0 && (
        <>
          <SectionLabel>Needs you · {needs.length}</SectionLabel>
          <List>
            {needs.map(({ u, what }) => (
              <button key={u.okla + what} onClick={() => onPick(u)} className="row" aria-label={`${u.building}: ${what}`}>
                <span className="dot text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{u.building}</div>
                  <div className="mt-0.5 truncate text-sm text-ink-2">{what}</div>
                </div>
              </button>
            ))}
          </List>
        </>
      )}

      {overdue.length > 0 && (
        <>
          <SectionLabel>Overdue · {overdue.length}</SectionLabel>
          <List>
            {overdue.map((u) => (
              <UnitRow key={u.okla} u={u} onPick={onPick} showAccount />
            ))}
          </List>
        </>
      )}

      <SectionLabel>Coming up · next 30 days</SectionLabel>
      {soon.length > 0 ? (
        <List>
          {soon.map((u) => (
            <UnitRow key={u.okla} u={u} onPick={onPick} showAccount />
          ))}
        </List>
      ) : (
        <p className="px-1 text-sm text-ink-3">Nothing due in the next 30 days.</p>
      )}
    </Screen>
  );
}

// What the Today tab lists (also used for the count bubble on its tab):
// needs = things only a person can do (the same two the phone alerts cover),
// overdue = past due and not inspected yet, soon = due within 30 days.
function todayLists(accounts: Account[]) {
  const all = accounts.flatMap((a) => a.units).filter((u) => u.active !== false);
  const needs = all.flatMap((u) => {
    const out: { u: Elevator; what: string }[] = [];
    if (stage(u, "visit") === "Booked") {
      const trip = stage(u, "tripDay");
      out.push({ u, what: daysUntil(trip) === 0 ? "You're inspecting it today" : trip ? `Booked for ${humanDate(trip)}` : "Visit booked" });
    }
    if (stage(u, "maintConfirm") === "Waiting")
      out.push({ u, what: isAmerican(u.maintCo) ? `Waiting on the safety test from ${u.maintCo}` : "Waiting on the safety test from the customer" });
    if (stage(u, "visit") === "Inspected" && stage(u, "report") !== "Sent" && !u.reportDone)
      out.push({ u, what: "The report isn't finished" });
    if (u.safetyTest === "No" && stage(u, "visit") !== "Inspected") out.push({ u, what: "No passing safety test in the last 12 months" });
    const d = daysUntil(u.due);
    if (!hasSheetPrice(u) && stage(u, "quote") !== "Sent" && d !== null && d <= 60) out.push({ u, what: "Price missing — the quote can't go out" });
    return out;
  });
  const days = (u: Elevator) => daysUntil(u.due);
  // Booked visits already show under "Needs you", so they are left out of these two.
  const notDone = (u: Elevator) => !["Inspected", "Booked"].includes(stage(u, "visit"));
  const overdue = all.filter((u) => (days(u) ?? 1) < 0 && notDone(u)).sort((a, b) => days(a)! - days(b)!);
  const soon = all
    .filter((u) => {
      const d = days(u);
      return d !== null && d >= 0 && d <= 30 && notDone(u);
    })
    .sort((a, b) => days(a)! - days(b)!);
  return { needs, overdue, soon };
}

// Elevators: every elevator, searchable, grouped by account; + adds a new one.
function ElevatorsTab({
  accounts,
  error,
  onPick,
  onNew,
}: {
  accounts: Account[] | null;
  error: string;
  onPick: (e: Elevator) => void;
  onNew: () => void;
}) {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"all" | "soon">("all");
  const query = q.trim().toLowerCase();

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
  // "All" = grouped by account, soonest-due first. "Due soon" = one flat list
  // within the window. (Plain calculations — the roster is small.)
  const list = accounts ?? [];
  const grouped = list
    .map((a) => ({ ...a, units: a.units.filter((u) => matches(u, a.name)).sort(byDue) }))
    .filter((a) => a.units.length > 0);
  const dueSoon = list
    .flatMap((a) => a.units.filter((u) => matches(u, a.name)))
    .filter((u) => {
      const d = daysUntil(u.due);
      return d !== null && d <= DUE_SOON_DAYS;
    })
    .sort(byDue);
  const count = list.reduce((n, a) => n + a.units.length, 0);

  return (
    <Screen bottomSpace>
      <div className="flex items-end justify-between">
        <Title eyebrow={accounts ? `${count} on the dashboard` : " "}>Elevators</Title>
        <button onClick={onNew} className="icon-btn btn-primary" aria-label="New elevator">
          <PlusIcon />
        </button>
      </div>

      <label className="relative mt-5 block">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3">
          <SearchIcon />
        </span>
        <input
          className="input pl-10"
          placeholder="Search buildings, accounts, or OK #"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>

      <div className="mt-3">
        <Segmented
          options={[
            ["all", "All"],
            ["soon", "Due soon"],
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>

      {!accounts && <RosterStatus error={error} />}

      {accounts && mode === "all" && (
        <>
          {grouped.map((a) => (
            <div key={a.name}>
              <SectionLabel>
                {a.name} · {a.units.length}
              </SectionLabel>
              <List>
                {a.units.map((u) => (
                  <UnitRow key={u.okla} u={u} onPick={onPick} />
                ))}
              </List>
            </div>
          ))}
          {grouped.length === 0 && <p className="mt-8 text-center text-sm text-ink-3">No matches.</p>}
        </>
      )}

      {accounts && mode === "soon" && (
        <>
          <SectionLabel>Due within {DUE_SOON_DAYS} days</SectionLabel>
          {dueSoon.length > 0 ? (
            <List>
              {dueSoon.map((u) => (
                <UnitRow key={u.okla} u={u} onPick={onPick} showAccount />
              ))}
            </List>
          ) : (
            <p className="mt-4 text-center text-sm text-ink-3">Nothing due in the next {DUE_SOON_DAYS} days.</p>
          )}
        </>
      )}
    </Screen>
  );
}

// One row on the Money tab: building, what stage the bill is at, and the amount.
function MoneyRow({ u, note, onPick }: { u: Elevator; note: string; onPick: (e: Elevator) => void }) {
  return (
    <button onClick={() => onPick(u)} className="row" aria-label={`${u.building}: ${note}`}>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{u.building}</div>
        <div className="mt-0.5 truncate text-sm text-ink-2">{note}</div>
      </div>
      <span className={"font-semibold tabular-nums " + (priceOf(u) ? "" : "text-warn")}>{priceOf(u) ? money(priceOf(u)) : "No price"}</span>
    </button>
  );
}

// Money: bills that are out and not paid yet, reports about to be billed, and
// what's been collected this cycle. Read from the same list as the other tabs.
// Is the whole system running? (null while checking.) Screens that describe what
// "is going out" must say so honestly when it's paused.
function useMasterOn(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    call("/api/switches?only=master")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { master?: boolean } | null) => setOn(d && typeof d.master === "boolean" ? d.master : null))
      .catch(() => setOn(null));
  }, []);
  return on;
}

// One line of the dashboard's Payments tab (src/lib/payments.ts) — every payment
// ever, kept after the yearly reset clears the elevator's Invoice / Paid steps.
type PaymentLine = { paidOn: string; okla: string; building: string; account: string; amount: number; invoice: string; tripDay: string };

function MoneyTab({ accounts, error, onPick }: { accounts: Account[] | null; error: string; onPick: (e: Elevator) => void }) {
  const master = useMasterOn();
  const [payments, setPayments] = useState<PaymentLine[] | null>(null);
  useEffect(() => {
    call("/api/payments")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { payments?: PaymentLine[] } | null) => setPayments(d?.payments ?? []))
      .catch(() => setPayments([]));
  }, []);
  if (!accounts) {
    return (
      <Screen bottomSpace>
        <Title eyebrow="Bills and payments">Money</Title>
        <RosterStatus error={error} />
      </Screen>
    );
  }
  const all = accounts.flatMap((a) => a.units);
  const paid = (u: Elevator) => stage(u, "paid") === "Paid";
  const outstanding = all.filter((u) => stage(u, "invoice") === "Sent" && !paid(u));
  const toBill = all.filter((u) => stage(u, "report") === "Sent" && stage(u, "invoice") !== "Sent" && !paid(u));
  const sum = (list: Elevator[]) => list.reduce((n, u) => n + priceOf(u), 0);
  // Collected this year: the Payments log, plus any elevator marked Paid that
  // the automation hasn't logged yet (it logs it within the hour, at the reset).
  const year = String(new Date().getFullYear());
  const logged = (payments ?? []).filter((p) => p.paidOn.endsWith(year)).reverse();
  const unlogged = all.filter((u) => paid(u) && !logged.some((p) => p.okla === u.okla && p.tripDay === stage(u, "tripDay")));
  const collectedTotal = logged.reduce((n, p) => n + p.amount, 0) + sum(unlogged);
  const collectedCount = logged.length + unlogged.length;
  const byOkla = new Map(all.map((u) => [u.okla, u]));
  // Nothing is billed or reset while the whole system, or that elevator, is paused.
  const held = (u: Elevator) => master === false || u.active === false;

  return (
    <Screen bottomSpace>
      <Title eyebrow="Bills and payments">Money</Title>
      {master === false && (
        <Glass pad className="mt-4">
          <p className="text-[15px] text-ink-2">
            <span className="font-semibold text-danger">The whole system is paused</span> — no invoices, reminders or
            emails go out until it&apos;s turned back on (Settings → System).
          </p>
        </Glass>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Glass pad>
          <div className="text-sm text-ink-2">Waiting on</div>
          <div className="mt-1 text-[26px] font-bold tracking-tight tabular-nums">{money(sum(outstanding))}</div>
          <div className="text-xs text-ink-3">
            {outstanding.length} {outstanding.length === 1 ? "bill" : "bills"} out
          </div>
        </Glass>
        <Glass pad>
          <div className="text-sm text-ink-2">Collected in {year}</div>
          <div className="mt-1 text-[26px] font-bold tracking-tight tabular-nums text-accent-ink">
            {payments === null ? "…" : money(collectedTotal)}
          </div>
          <div className="text-xs text-ink-3">{collectedCount} paid</div>
        </Glass>
      </div>

      <SectionLabel>Waiting on payment · {outstanding.length}</SectionLabel>
      {outstanding.length > 0 ? (
        <List>
          {outstanding.map((u) => (
            <MoneyRow
              key={u.okla}
              u={u}
              onPick={onPick}
              note={stage(u, "followUps") ? `Reminder ${stage(u, "followUps")}` : "Invoice sent"}
            />
          ))}
        </List>
      ) : (
        <p className="px-1 text-sm text-ink-3">No unpaid bills.</p>
      )}

      {toBill.length > 0 && (
        <>
          <SectionLabel>Being billed now · {toBill.length}</SectionLabel>
          <List>
            {toBill.map((u) => (
              <MoneyRow key={u.okla} u={u} onPick={onPick} note={held(u) ? "Report filed — billing paused" : "Report filed — invoice going out"} />
            ))}
          </List>
        </>
      )}

      <SectionLabel>Paid in {year} · {collectedCount}</SectionLabel>
      {collectedCount > 0 ? (
        <List>
          {unlogged.map((u) => (
            <MoneyRow key={`now-${u.okla}`} u={u} onPick={onPick} note={held(u) ? "Paid" : "Paid — next year's cycle is being set"} />
          ))}
          {logged.map((p, i) => {
            const u = byOkla.get(p.okla);
            return (
              // An elevator no longer on the dashboard has no profile to open, so its
              // line is plain text, not a button that does nothing.
              u ? (
                <button key={`${p.okla}-${p.invoice}-${i}`} onClick={() => onPick(u)} className="row" aria-label={`${p.building}: paid ${p.paidOn}`}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{p.building}</div>
                    <div className="mt-0.5 truncate text-sm text-ink-2">Paid {humanDate(p.paidOn)}</div>
                  </div>
                  <span className="font-semibold tabular-nums">{money(p.amount)}</span>
                </button>
              ) : (
                <div key={`${p.okla}-${p.invoice}-${i}`} className="row">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{p.building}</div>
                    <div className="mt-0.5 truncate text-sm text-ink-2">Paid {humanDate(p.paidOn)} · no longer on the dashboard</div>
                  </div>
                  <span className="font-semibold tabular-nums">{money(p.amount)}</span>
                </div>
              )
            );
          })}
        </List>
      ) : (
        <p className="px-1 text-sm text-ink-3">{payments === null ? "Loading…" : `Nothing paid yet in ${year}.`}</p>
      )}
    </Screen>
  );
}

/* ---------- new elevator ---------- */

const NEW_TYPES = [
  "Elevator (Traction)",
  "Elevator (Hydraulic)",
  "Escalator",
  "Moving Walk",
  "Wheelchair/Platform Lift",
];
const MONEY_PATHS = ["Quote to PO to invoice", "Invoice only"];
// The state form's radio choices — one shared list with the PDF filler.
const DEVICE_TYPES = Object.keys(DEVICE_TYPE_CODE);
const MACHINE_TYPES = Object.keys(MACHINE_TYPE_CODE);
const ENTITY_TYPES = Object.keys(ENTITY_TYPE_CODE);

type NewForm = {
  // dashboard row (cols A..R)
  okla: string; building: string; account: string; type: string; floors: string; cycle: string; due: string;
  city: string; area: string; contact: string; email: string; phone: string;
  maintCo: string; maintContact: string; maintEmail: string; maintPhone: string;
  price: string; moneyPath: string;
} & Record<TechKey, string>; // + the state-form details (saved on the dashboard, AQ–BK)
const BLANK_FORM: NewForm = {
  okla: "", building: "", account: "", type: "", floors: "", cycle: "", due: "",
  city: "", area: "", contact: "", email: "", phone: "",
  maintCo: "", maintContact: "", maintEmail: "", maintPhone: "", price: "", moneyPath: "",
  ...(Object.fromEntries(TECH_KEYS.map((k) => [k, ""])) as Record<TechKey, string>),
};

// The details list the report screen shows (and the PDF filler reads).
function carriedFromForm(f: Record<TechKey, string>): { label: string; value: string }[] {
  return TECH.map((t) => ({ label: t.label, value: f[t.key] ?? "" }));
}

// Module-level so it isn't recreated each render (which would drop input focus).
function TextRow({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <input className="input" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

// The state-form details (serial, permit, owner, …) as input boxes / choices —
// the same set on "New elevator" and on the profile's "For the state form" editor.
function TechFields({
  values,
  onChange,
  only,
}: {
  values: Record<TechKey, string>;
  onChange: (k: TechKey, v: string) => void;
  only?: TechKey[]; // just these (the report screen's missing ones)
}) {
  const choices: Partial<Record<TechKind, string[]>> = { device: DEVICE_TYPES, machine: MACHINE_TYPES, entity: ENTITY_TYPES };
  return (
    <>
      {TECH.filter((t) => !only || only.includes(t.key)).map((t) =>
        choices[t.kind] ? (
          <Field key={t.key} label={t.label}>
            <Chips options={choices[t.kind]!} value={values[t.key]} onChange={(v) => onChange(t.key, v)} />
          </Field>
        ) : (
          <TextRow key={t.key} label={t.label} value={values[t.key]} placeholder={t.hint} onChange={(v) => onChange(t.key, v)} />
        ),
      )}
    </>
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
  const floors = parseInt(f.floors, 10) || 0;
  const price = computePrice(f.type, floors); // null until Type (and Floors, for elevators) are picked

  async function create() {
    if (!ready) {
      setErr("Oklahoma #, Building, and Account are required.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const payload = { ...f, cycle, price: price == null ? "" : `$${price}` };
      const data = await postJson<{ row?: number }>("/api/elevators", payload);
      // Open the new elevator's profile right away (with its details and sheet
      // row) — its yearly cycle starts from the dashboard like any other. (Its
      // inspection opens once the steps before it are done; see inOrder.ts.)
      const cycleNum = cycle.match(/\d/)?.[0] || "1";
      const elevator: Elevator = {
        okla: f.okla.trim(),
        building: f.building.trim(),
        account: f.account.trim(),
        contact: f.contact,
        email: f.email,
        area: f.area,
        city: f.city,
        type: f.type,
        floors,
        cycle: cycleNum,
        due: f.due,
        row: data.row ?? undefined,
        lifecycle: [],
        carried: carriedFromForm(f),
        lastYear: { date: "", inspType: "Initial", test1: "", test5: "", certIssue: "Yes", condition: "No adverse conditions", notes: "" },
      };
      buzz();
      void refreshRoster(); // the new elevator appears in the list
      onCreated(elevator);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar back={{ label: "Elevators", onClick: onBack }} />
      <Title eyebrow="Add to the dashboard">New elevator</Title>

      <SectionLabel>Identity</SectionLabel>
      <Glass pad>
        <TextRow label="Oklahoma # (required)" value={f.okla} onChange={(v) => set("okla", v)} />
        <TextRow label="Building (required)" value={f.building} onChange={(v) => set("building", v)} />
        <TextRow label="Account (required)" value={f.account} onChange={(v) => set("account", v)} />
        <Field label="Type">
          <Chips options={NEW_TYPES} value={f.type} onChange={(v) => set("type", v)} />
        </Field>
        <TextRow label="Floors" value={f.floors} onChange={(v) => set("floors", v)} type="number" />
        <Field label="Inspection cycle (automatic)">
          <div className="flex items-center justify-between rounded-field bg-fill px-3.5 py-3">
            <span className="font-semibold">{cycle}</span>
            <span className="text-sm text-ink-3">{annual ? "annual exception" : "from type"}</span>
          </div>
        </Field>
        <label className="mb-4 flex items-start gap-2.5 text-[15px] text-ink-2">
          <input
            type="checkbox"
            checked={annual}
            onChange={(e) => setAnnual(e.target.checked)}
            className="mt-1 h-4 w-4 accent-accent"
          />
          <span>Hospital, nursing home, or mobility-restricted facility (inspect every year regardless of type)</span>
        </label>
        <TextRow label="Next due date" value={f.due} onChange={(v) => set("due", v)} type="date" />
      </Glass>

      <SectionLabel>For the state form</SectionLabel>
      <Glass pad>
        <p className="mb-3 text-sm text-ink-3">
          Saved on the dashboard, so every report has them. Fill in what you know — you can add the rest later on the
          elevator&apos;s profile.
        </p>
        <TechFields values={f} onChange={(k, v) => set(k, v)} />
      </Glass>

      <SectionLabel>Location & contact</SectionLabel>
      <Glass pad>
        <div className="grid grid-cols-2 gap-3">
          <TextRow label="City" value={f.city} onChange={(v) => set("city", v)} />
          <TextRow label="Area" value={f.area} onChange={(v) => set("area", v)} />
        </div>
        <TextRow label="Contact name" value={f.contact} onChange={(v) => set("contact", v)} />
        <TextRow label="Customer email" value={f.email} onChange={(v) => set("email", v)} type="email" />
        <TextRow label="Customer phone" value={f.phone} onChange={(v) => set("phone", v)} />
      </Glass>

      <SectionLabel>Maintenance company</SectionLabel>
      <Glass pad>
        <TextRow label="Company" value={f.maintCo} onChange={(v) => set("maintCo", v)} />
        <TextRow label="Contact" value={f.maintContact} onChange={(v) => set("maintContact", v)} />
        <TextRow label="Email" value={f.maintEmail} onChange={(v) => set("maintEmail", v)} type="email" />
        <TextRow label="Phone" value={f.maintPhone} onChange={(v) => set("maintPhone", v)} />
      </Glass>

      <SectionLabel>Billing</SectionLabel>
      <Glass pad>
        <div className="mb-4 flex items-baseline justify-between rounded-control bg-accent-soft px-4 py-3.5">
          <span className="text-sm font-medium text-accent-ink">Price (automatic)</span>
          <span className="text-2xl font-bold tracking-tight text-accent-ink">{formatPrice(price)}</span>
        </div>
        {price == null && (
          <p className="mb-4 text-sm text-warn">Pick a Type (and Floors, for elevators) above to price it.</p>
        )}
        <Field label="Money path">
          <Chips options={MONEY_PATHS} value={f.moneyPath} onChange={(v) => set("moneyPath", v)} />
        </Field>
      </Glass>

      {err && <p className="mt-5 px-1 text-sm font-semibold text-danger">{err}</p>}

      <Button full onClick={create} disabled={busy} className="mt-6">
        {busy ? "Saving…" : "Save elevator"}
      </Button>
      <p className="mt-3 px-1 text-sm text-ink-3">
        Adds the elevator to your dashboard and opens its profile. The automatic emails start from its due date;
        the inspection opens once the visit is booked.
      </p>
    </Screen>
  );
}

/* ---------- profile ---------- */

// Lifecycle values that mean "in progress, waiting on someone" (shown as the
// breathing "now" node); any other value means the step is done.
const IN_PROGRESS = new Set(["Waiting", "Awaiting", "Booked", "Review", "No answer"]);

// How each Customer lifecycle step looks (Robert, 2026-10-15: "nothing should be
// green if not all of the things before it are green"), top to bottom:
//   tl-done  green check — done (or doesn't apply to this elevator: "Not needed")
//   tl-now   green ring  — started, waiting on someone (Waiting, Booked, …)
//   tl-todo  gray        — not done yet, or anything after a step that isn't
//                          done (only possible by hand — Calendly bookings can't
//                          land out of order, see src/lib/booking.ts)
// "Invoice only" elevators have no quote or PO steps at all (they're hidden; see
// the "Quote and PO first" switch on the elevator page). Steps that don't apply
// count as done: the access
// reminder once the visit is inspected without one; payment reminders once paid
// (they're only ever needed when a bill is late, so they never hold others back).
type StepLook = { look: "tl-done" | "tl-now" | "tl-todo"; note: string };
function lifecycleLooks(e: Elevator): Map<string, StepLook> {
  const invoiceOnly = e.moneyPath === "Invoice only";
  const inspected = stage(e, "visit") === "Inspected";
  const paid = stage(e, "paid") === "Paid";
  const notNeeded = (key: string) => (key === "accessReminder" && inspected) || (key === "followUps" && paid);
  const optional = (key: string) => key === "followUps" || key === "newTimer";
  const out = new Map<string, StepLook>();
  let gap = false;
  for (const s of e.lifecycle) {
    if (invoiceOnly && (s.key === "quote" || s.key === "po")) continue; // not shown
    // The quote went out and the customer hasn't sent a PO yet: waiting on them.
    // The PO is out of our hands, so it doesn't hold up the steps after it.
    if (s.key === "po" && (!s.value || s.value === "Awaiting") && !invoiceOnly && stage(e, "quote") === "Sent") {
      out.set(s.key, { look: gap ? "tl-todo" : "tl-now", note: gap ? "" : "Waiting for PO" });
      continue;
    }
    if (!s.value) {
      if (notNeeded(s.key)) out.set(s.key, { look: gap ? "tl-todo" : "tl-done", note: gap ? "" : "Not needed" });
      else {
        out.set(s.key, { look: "tl-todo", note: "" });
        if (!optional(s.key)) gap = true;
      }
      continue;
    }
    if (gap) out.set(s.key, { look: "tl-todo", note: s.value });
    else out.set(s.key, { look: IN_PROGRESS.has(s.value) ? "tl-now" : "tl-done", note: s.value });
  }
  return out;
}

// Tap a lifecycle step → a sheet to change it; saving asks once more in the same sheet.
// FAST TRACK, per step: each automatic pre-visit step can get its own date and
// time (from that step's sheet, or "Access fast track" for the next one). Save →
// "Are you sure?" → saved. Each time must be at least an hour from now and an
// hour after the step before it (src/lib/fasttrack.ts).
const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const localTime = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
// "Wed, Oct 21" — Calendly bookings are whole days.
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const whenText = (iso: string | number) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fastInputs = (e: Elevator): FastInputs => ({
  email: e.email ?? "",
  price: e.price ?? "",
  moneyPath: e.moneyPath ?? "",
  twoMoEmail: stage(e, "twoMoEmail"),
  quote: stage(e, "quote"),
  po: stage(e, "po"),
  maintConfirm: stage(e, "maintConfirm"),
  scheduling: stage(e, "scheduling"),
  accessReminder: stage(e, "accessReminder"),
  visit: stage(e, "visit"),
  tripDay: stage(e, "tripDay"),
});

// "Now", refreshed every half minute, so time limits stay true while a sheet is open.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function FastTrackSheet({
  elevator: e,
  step,
  onClose,
  onSaved,
}: {
  elevator: Elevator;
  step: FastStepKey;
  onClose: () => void;
  onSaved: (fastTrack: FastTimes) => void;
}) {
  const times = e.fastTrack ?? {};
  const current = times[step];
  const now = useNow();
  // The allowed range, ignoring this step's own old time.
  const win = fastWindow(fastInputs(e), { ...times, [step]: undefined }, step, now);
  // Default: the time already set, or the first quarter hour the rules allow
  // (the automation checks every quarter hour, any time of day).
  const [start] = useState(() =>
    new Date(upToQuarterHour(current ? new Date(current).getTime() : "min" in win ? win.min : Date.now() + FAST_MIN_LEAD_MS)),
  );
  const [date, setDate] = useState(localDate(start));
  const [time, setTime] = useState(localTime(start));
  const [mode, setMode] = useState<"edit" | "confirm" | "cancel">("edit");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const when = new Date(`${date}T${time}`);
  const ms = when.getTime();
  const problem =
    "none" in win
      ? win.none
      : Number.isNaN(ms)
        ? "Pick a date and time."
        : ms < win.min - 60_000
          ? `Pick ${whenText(win.min)} or later.`
          : ms > win.max
            ? `Pick ${whenText(win.max)} or earlier.`
            : "";
  // Cancelling also clears the steps after this one (they'd only wait on it).
  const alsoCleared = fastCancelSet(times, step).filter((k) => k !== step);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setErr("");
    try {
      const d = await postJson<{ fastTrack?: FastTimes }>("/api/fasttrack", { row: e.row, okla: e.okla, step, ...body });
      if (!d.fastTrack) throw new Error("The fast track didn't save — try again.");
      buzz();
      onSaved(d.fastTrack);
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Save failed");
      setMode("edit");
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <Button variant="secondary" full onClick={() => setMode("edit")} disabled={busy}>
      Back
    </Button>
  );
  return (
    <Sheet onClose={busy ? () => {} : onClose}>
      {mode === "confirm" ? (
        <>
          <h3 className="text-[21px] font-bold tracking-tight">Are you sure?</h3>
          <p className="mt-1.5 text-[15px] text-ink-2">
            Send {FAST_STEPS[step].what} for <span className="font-semibold text-ink">{e.building}</span> at the first
            automatic check after <span className="font-semibold text-ink">{whenText(ms)}</span>?
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            <Button full onClick={() => send({ at: when.toISOString() })} disabled={busy}>
              {busy ? "Saving…" : "Yes, save"}
            </Button>
            {back}
          </div>
        </>
      ) : mode === "cancel" ? (
        <>
          <h3 className="text-[21px] font-bold tracking-tight">Are you sure?</h3>
          <p className="mt-1.5 text-[15px] text-ink-2">
            Cancel the fast track for the {FAST_STEPS[step].label.toLowerCase()}
            {alsoCleared.length > 0 && (
              <> and the steps after it ({alsoCleared.map((k) => FAST_STEPS[k].label.toLowerCase()).join(", ")})</>
            )}
            ? {alsoCleared.length > 0 ? "They go back" : "It goes back"} to normal timing.
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            <Button full onClick={() => send({ cancel: true })} disabled={busy}>
              {busy ? "Cancelling…" : "Yes, cancel it"}
            </Button>
            {back}
          </div>
        </>
      ) : (
        <>
          <h3 className="text-[21px] font-bold tracking-tight">Fast track: {FAST_STEPS[step].label}</h3>
          <p className="mb-4 mt-1 text-sm text-ink-3">
            {current ? (
              <>
                Set for <span className="font-semibold text-ink">{whenText(current)}</span>.{" "}
              </>
            ) : null}
            Sends {FAST_STEPS[step].what} early, at the time you pick — any time of day, on the quarter hour (the
            automation checks at :00, :15, :30 and :45). Each step needs at least an hour after the one before it.
          </p>
          {"none" in win ? (
            <p className="text-sm font-semibold text-danger">{win.none}</p>
          ) : (
            <>
              <div className="flex gap-2.5">
                <input type="date" className="input flex-1" value={date} min={localDate(new Date(win.min))} onChange={(ev) => setDate(ev.target.value)} />
                <select className="input flex-1" aria-label="Hour" value={time.slice(0, 2)} onChange={(ev) => setTime(ev.target.value + time.slice(2))}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={String(h).padStart(2, "0")}>
                      {h % 12 || 12} {h < 12 ? "AM" : "PM"}
                    </option>
                  ))}
                </select>
                <select className="input w-24" aria-label="Minute" value={time.slice(3, 5)} onChange={(ev) => setTime(time.slice(0, 3) + ev.target.value)}>
                  {["00", "15", "30", "45"].map((m) => (
                    <option key={m} value={m}>
                      :{m}
                    </option>
                  ))}
                </select>
              </div>
              {problem && <p className="mt-2 text-sm font-semibold text-danger">{problem}</p>}
            </>
          )}
          {err && <p className="mt-2 text-sm font-semibold text-danger">{err}</p>}
          <div className="mt-5 flex flex-col gap-2.5">
            {!("none" in win) && (
              <Button full onClick={() => setMode("confirm")} disabled={!!problem}>
                Save
              </Button>
            )}
            {current && (
              <Button variant="secondary" full onClick={() => setMode("cancel")}>
                Cancel the fast track
              </Button>
            )}
            <Button variant="secondary" full onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function LifecycleEditor({
  stage,
  row,
  okla,
  fastAt,
  fastNote,
  onFastTrack,
  onClose,
  onSaved,
}: {
  stage: LifecycleStage;
  row?: number;
  okla: string; // sent with the row so the server can check it's still the same elevator
  fastAt?: string; // this step's fast-track time, if set
  fastNote?: string; // why this step can't be fast-tracked yet
  onFastTrack?: () => void; // this step can be fast-tracked → opens the fast-track sheet
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
      await postJson("/api/lifecycle", { row, okla, col: stage.col, value: choice });
      buzz();
      onSaved(choice);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={busy ? () => {} : onClose}>
      {confirm ? (
        <>
          <h3 className="text-[21px] font-bold tracking-tight">Are you sure?</h3>
          <p className="mt-1.5 text-[15px] text-ink-2">
            Set <span className="font-semibold text-ink">{stage.label}</span> to{" "}
            <span className="font-semibold text-ink">{show(choice)}</span> on the live dashboard?
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            <Button full onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Yes, save"}
            </Button>
            <Button variant="secondary" full onClick={() => setConfirm(false)} disabled={busy}>
              Back
            </Button>
          </div>
        </>
      ) : (
        <>
          <h3 className="text-[21px] font-bold tracking-tight">{stage.label}</h3>
          <p className="mb-4 mt-1 text-sm text-ink-3">Now: {show(stage.value)}</p>
          {stage.date ? (
            // A real date picker (saved the dashboard's way, M/D/YYYY) — typed text like "next tuesday" can't get in.
            <input
              type="date"
              className="input"
              value={toIsoDate(choice)}
              onChange={(ev) => {
                const v = ev.target.value;
                setChoice(v ? `${+v.slice(5, 7)}/${+v.slice(8, 10)}/${v.slice(0, 4)}` : "");
              }}
            />
          ) : stage.options.length > 0 ? (
            <Chips options={stage.options} value={choice} onChange={setChoice} />
          ) : (
            <input className="input" placeholder="Type a value" value={choice} onChange={(e) => setChoice(e.target.value)} />
          )}
          <Button variant="quiet" onClick={() => setChoice("")} className="mt-3 text-sm">
            Clear this step
          </Button>
          {err && <p className="mt-2 text-sm font-semibold text-danger">{err}</p>}
          <div className="mt-5 flex flex-col gap-2.5">
            <Button full onClick={() => setConfirm(true)} disabled={!changed}>
              Save
            </Button>
            <Button variant="secondary" full onClick={onClose}>
              Cancel
            </Button>
          </div>
          {!onFastTrack && fastNote && <p className="mt-7 text-sm text-ink-3">Fast track: {fastNote}</p>}
          {onFastTrack && (
            <div className="mt-7">
              <p className="text-sm text-ink-3">
                {fastAt ? (
                  <>
                    Fast track set: goes at the first check after{" "}
                    <span className="font-semibold text-ink">{whenText(fastAt)}</span>.
                  </>
                ) : (
                  "Send this step early, at a date and time you pick."
                )}
              </p>
              <Button variant="secondary" full onClick={onFastTrack} className="mt-2.5">
                {fastAt ? "Change fast track" : "Fast track this step"}
              </Button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

// The "Next step" cards at the top of a profile — the same situations the phone
// alerts are about, each with the button that deals with it. Most urgent first.
type NextStep = {
  title: string;
  text: string;
  actions: { label: string; href?: string; onClick?: () => void }[];
  startsReport?: boolean;
};
function nextSteps(
  e: Elevator,
  onStartReport: () => void,
  onEnterSafety: () => void,
): NextStep[] {
  const out: NextStep[] = [];
  const visit = stage(e, "visit");
  // Only steps reached in order (everything before them done) get a card — a
  // value set out of order means nothing until the steps before it are done.
  const looks = lifecycleLooks(e);
  const reached = (key: string) => looks.get(key)?.look !== "tl-todo";
  const canInspect = inspectWhy(e) === null;
  const trip = stage(e, "tripDay");
  const phoneCall = (label: string, phone?: string) => (phone ? [{ label, href: `tel:${phone}` }] : []);
  const mail = (label: string, email?: string, subject?: string) =>
    email ? [{ label, href: `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}` }] : [];

  if (visit === "Booked" && canInspect) {
    const today = daysUntil(trip) === 0;
    out.push({
      title: today ? "You're inspecting this today" : trip ? `Booked for ${humanDate(trip)}` : "A visit is booked",
      text: today ? "When you get there, start the report." : "Everything's set. Start the report when you're on site.",
      actions: [{ label: "Start inspection", onClick: onStartReport }],
      startsReport: true,
    });
  }
  if (stage(e, "maintConfirm") === "Waiting" && reached("maintConfirm")) {
    // American Elevator is asked directly; for anyone else we asked the customer.
    const american = isAmerican(e.maintCo);
    const who = american ? e.maintCo || "American Elevator" : e.contact || "The customer";
    const phone = american ? e.maintPhone : e.phone;
    const email = american ? e.maintEmail : e.email;
    out.push({
      title: "Still waiting on the safety test",
      text: `${who} hasn't told us yet whether it had a passing safety test in the last 12 months. If you get the answer by phone, enter it here.`,
      actions: [
        { label: "Enter answer", onClick: onEnterSafety },
        ...phoneCall(american ? "Call them" : "Call customer", phone),
        ...mail(american ? "Email them" : "Email customer", email, `Safety test for ${e.building}`),
      ],
    });
  }
  if (visit === "Inspected" && canInspect) {
    out.push(
      e.reportDone
        ? {
            title: "Report is on its way",
            text: "The finished report goes to the customer and the state at the next automatic check (every hour, 7am–6pm).",
            actions: [],
          }
        : {
            title: "The report isn't finished",
            text: "The visit is marked done, but no report has been finished for it — so nothing can be sent to the customer or the state yet.",
            actions: [{ label: "Finish report", onClick: onStartReport }],
            startsReport: true,
          },
    );
  }
  if (e.safetyTest === "No" && visit !== "Inspected" && reached("maintConfirm")) {
    const american = isAmerican(e.maintCo);
    out.push({
      title: "No passing safety test",
      text: "The answer was No — it hasn't passed a safety test in the last 12 months. Decide with the customer or maintenance company what happens before the inspection.",
      actions: [
        ...phoneCall("Call customer", e.phone),
        ...phoneCall(american ? "Call American" : "Call maintenance", e.maintPhone),
      ],
    });
  }
  if (!hasSheetPrice(e) && stage(e, "quote") !== "Sent" && (daysUntil(e.due) ?? 999) <= 60) {
    out.push({
      title: "Price missing",
      text: "There's no price on this elevator, so the quote can't go out. Ask the assistant to set it (it prices by type and floors), or fill it in on the dashboard.",
      actions: [],
    });
  }
  const d = daysUntil(e.due);
  if (d !== null && d < 0 && visit !== "Booked" && visit !== "Inspected") {
    out.push({
      title: "Past due",
      text: `It was due ${humanDate(e.due)} and no visit is booked yet.`,
      actions: [...phoneCall("Call customer", e.phone), ...mail("Email customer", e.email, `Scheduling the inspection at ${e.building}`)],
    });
  }
  if (stage(e, "invoice") === "Sent" && stage(e, "paid") !== "Paid" && reached("invoice")) {
    const reminder = stage(e, "followUps");
    out.push({
      title: "Waiting on payment",
      text: `The ${e.price || "invoice"} bill is out${reminder ? ` and reminder ${reminder.replace(" sent", "")} has gone out` : ""}. Nothing to do unless it drags on.`,
      actions: phoneCall("Call customer", e.phone),
    });
  }
  return out;
}

// Enter the safety-test answer by hand — for when April or Robert gets it on a
// phone call instead of through the emailed form. Same two questions as the form.
function SafetyEditor({ elevator, onClose, onSaved }: { elevator: Elevator; onClose: () => void; onSaved: (e: Elevator) => void }) {
  const [answer, setAnswer] = useState<string>(elevator.safetyTest ?? "");
  const [date, setDate] = useState(toIsoDate(elevator.safetyTestDate));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (answer !== "Yes" && answer !== "No") return setErr("Choose Yes or No.");
    if (answer === "Yes" && !date) return setErr("Enter the date of the safety test.");
    // A typed year can run past 4 digits in some date boxes — the same check the server makes.
    if (answer === "Yes" && checkSafetyDate(date)) return setErr(checkSafetyDate(date));
    if (elevator.row == null) return setErr("This elevator has no saved row yet.");
    setBusy(true);
    setErr("");
    try {
      await postJson("/api/records", { row: elevator.row, okla: elevator.okla, result: answer, date });
      buzz();
      // Show the answer everywhere right away (and move the records step on) —
      // including the report's "one-year test" box, which is filled from it.
      const [y, m, day] = date.split("-");
      const yes = answer === "Yes" && !!y;
      onSaved({
        ...elevator,
        safetyTest: answer as "Yes" | "No",
        safetyTestDate: yes ? `${+m}/${+day}/${y}` : "",
        lastYear: { ...elevator.lastYear, date: yes ? date : "", test1: yes ? `${m}/${y}` : "", certIssue: answer === "No" ? "No" : "Yes" },
        lifecycle: elevator.lifecycle.map((s) => (s.key === "maintConfirm" ? { ...s, value: "Answered" } : s)),
      });
      void refreshRoster();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={busy ? () => {} : onClose}>
      <h3 className="text-[21px] font-bold tracking-tight">Safety test</h3>
      <p className="mt-1 text-sm text-ink-3">{elevator.building} · entered by hand</p>
      <div className="mt-5">
        <Field label="Has it had a passing safety test in the last 12 months?">
          <Chips options={["Yes", "No"]} value={answer} onChange={setAnswer} />
        </Field>
        {answer !== "No" && (
          <Field label="What date was that safety test?">
            <input type="date" className="input" value={date} max={isoToday()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
      </div>
      <p className="mt-1 text-sm text-ink-3">{WHERE_TO_FIND}</p>
      {err && <p className="mt-3 text-sm font-semibold text-danger">{err}</p>}
      <div className="mt-5 flex flex-col gap-2.5">
        <Button full onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save answer"}
        </Button>
        <Button variant="secondary" full onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}

// Edit the state-form details (profile → "For the state form"). Saved to the
// dashboard, so every report — this year and every year after — has them.
function TechEditor({ elevator, onClose, onSaved }: { elevator: Elevator; onClose: () => void; onSaved: (e: Elevator) => void }) {
  const start = Object.fromEntries(TECH.map((t) => [t.key, elevator.carried.find((c) => c.label === t.label)?.value ?? ""])) as Record<TechKey, string>;
  const [v, setV] = useState(start);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (elevator.row == null) return setErr("This elevator has no saved row yet.");
    const changed = Object.fromEntries(TECH_KEYS.filter((k) => v[k] !== start[k]).map((k) => [k, v[k]]));
    if (!Object.keys(changed).length) return onClose();
    setBusy(true);
    setErr("");
    try {
      await postJson("/api/details", { row: elevator.row, okla: elevator.okla, values: changed });
      buzz();
      onSaved({ ...elevator, carried: carriedFromForm(v) });
      void refreshRoster();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={busy ? () => {} : onClose}>
      <h3 className="text-[21px] font-bold tracking-tight">For the state form</h3>
      <p className="mt-1 text-sm text-ink-3">{elevator.building} · printed on every report</p>
      <div className="mt-5">
        <TechFields values={v} onChange={(k, val) => setV((p) => ({ ...p, [k]: val }))} />
      </div>
      {err && <p className="mt-3 text-sm font-semibold text-danger">{err}</p>}
      <div className="mt-5 flex flex-col gap-2.5">
        <Button full onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button variant="secondary" full onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}

// The report screen's "Fill them in": only the details the state form still
// needs (customer basics and/or saved details), saved to the dashboard.
function MissingDetailsSheet({
  elevator,
  need,
  onClose,
  onSaved,
}: {
  elevator: Elevator;
  need: (TechKey | BasicKey)[];
  onClose: () => void;
  onSaved: (e: Elevator) => void;
}) {
  const basics = FORM_BASICS.filter((b) => need.includes(b.key));
  const techOnly = TECH.filter((t) => need.includes(t.key)).map((t) => t.key);
  const [b, setB] = useState<Record<BasicKey, string>>({ contact: "", phone: "", email: "", city: "" });
  const [v, setV] = useState(
    () => Object.fromEntries(TECH.map((t) => [t.key, elevator.carried.find((c) => c.label === t.label)?.value ?? ""])) as Record<TechKey, string>,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (elevator.row == null) return setErr("This elevator has no saved row yet.");
    const values: Record<string, string> = {};
    for (const x of basics) if (b[x.key].trim()) values[x.key] = b[x.key].trim();
    for (const k of techOnly) if (v[k].trim()) values[k] = v[k].trim();
    if (!Object.keys(values).length) return onClose();
    setBusy(true);
    setErr("");
    try {
      await postJson("/api/details", { row: elevator.row, okla: elevator.okla, values });
      buzz();
      const next: Elevator = { ...elevator, carried: carriedFromForm(Object.fromEntries(TECH_KEYS.map((k) => [k, v[k].trim()])) as Record<TechKey, string>) };
      for (const x of basics) if (b[x.key].trim()) next[x.key] = b[x.key].trim();
      onSaved(next);
      void refreshRoster();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={busy ? () => {} : onClose}>
      <h3 className="text-[21px] font-bold tracking-tight">Still blank for the state form</h3>
      <p className="mt-1 text-sm text-ink-3">{elevator.building} · saved with the elevator for every report</p>
      <div className="mt-5">
        {basics.map((x) => (
          <TextRow
            key={x.key}
            label={x.label}
            type={x.key === "email" ? "email" : x.key === "phone" ? "tel" : "text"}
            value={b[x.key]}
            onChange={(val) => setB((p) => ({ ...p, [x.key]: val }))}
          />
        ))}
        <TechFields values={v} only={techOnly} onChange={(k, val) => setV((p) => ({ ...p, [k]: val }))} />
      </div>
      {err && <p className="mt-3 text-sm font-semibold text-danger">{err}</p>}
      <div className="mt-5 flex flex-col gap-2.5">
        <Button full onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button variant="secondary" full onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}

function Profile({
  elevator,
  onChange,
  backLabel,
  onBack,
  onStartReport,
}: {
  elevator: Elevator;
  onChange: (e: Elevator) => void; // a saved edit — the app keeps it, so the profile is right after a report and back
  backLabel: string; // the tab this was opened from ("Today", "Elevators", "Money")
  onBack: () => void;
  onStartReport: () => void;
}) {
  const e = elevator;
  const [editing, setEditing] = useState<LifecycleStage | null>(null);
  const [lockedTap, setLockedTap] = useState(""); // a step that's set automatically, just tapped

  // This elevator's on/off switch. Pausing takes two confirmations (a warning,
  // then a final yes); resuming takes one.
  const swOn = e.active !== false;
  const [enteringSafety, setEnteringSafety] = useState(false);
  const [editingTech, setEditingTech] = useState(false);
  // Fast track: each pre-visit step's own time (if set), and the next step that still needs one.
  const [fastStep, setFastStep] = useState<FastStepKey | null>(null);
  const fastTimes = e.fastTrack ?? {};
  const fastSet = FAST_ORDER.filter((k) => fastTimes[k]);
  const fastNext = nextFastStep(fastInputs(e), fastTimes);
  const now = useNow();
  const editingFast = editing ? fastStepForStage(editing.key) : undefined;
  const editingWin = editingFast ? fastWindow(fastInputs(e), { ...fastTimes, [editingFast]: undefined }, editingFast, now) : null;
  const steps = nextSteps(e, onStartReport, () => setEnteringSafety(true));
  const looks = lifecycleLooks(e);
  const [swStep, setSwStep] = useState<null | "pause1" | "pause2" | "resume">(null);
  // "Quote and PO first" — the elevator's billing type (on = quote + PO before the
  // visit, off = invoice only). Each way asks once more before it saves.
  const quotePO = e.moneyPath !== "Invoice only";
  const [qpStep, setQpStep] = useState<null | boolean>(null); // the value being confirmed
  const [qpBusy, setQpBusy] = useState(false);
  const [qpErr, setQpErr] = useState("");
  async function setQuotePO(next: boolean) {
    if (e.row == null) { setQpErr("This elevator has no saved row yet."); return; }
    setQpBusy(true);
    setQpErr("");
    try {
      await postJson("/api/switches", { target: "quotePO", row: e.row, okla: e.okla, on: next });
      buzz();
      onChange({ ...e, moneyPath: next ? "Quote to PO to invoice" : "Invoice only" });
      setQpStep(null);
    } catch (err) {
      setQpErr(err instanceof Error ? err.message : "Save failed");
    } finally {
      setQpBusy(false);
    }
  }
  const [swBusy, setSwBusy] = useState(false);
  const [swErr, setSwErr] = useState("");
  const closeSw = () => { setSwStep(null); setSwErr(""); };
  async function setSwitch(next: boolean) {
    if (e.row == null) { setSwErr("This elevator has no saved row yet."); return; }
    setSwBusy(true);
    setSwErr("");
    try {
      await postJson("/api/switches", { target: "elevator", row: e.row, okla: e.okla, on: next });
      buzz();
      onChange({ ...e, active: next });
      closeSw();
    } catch (err) {
      setSwErr(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSwBusy(false);
    }
  }

  return (
    <Screen>
      {editing && (
        <LifecycleEditor
          stage={editing}
          row={e.row}
          okla={e.okla}
          fastAt={editingFast ? fastTimes[editingFast] : undefined}
          fastNote={editingWin && "none" in editingWin && !editingWin.done ? editingWin.none : undefined}
          onFastTrack={
            // Offered once the step can take a time (or already has one).
            editingFast && (fastTimes[editingFast] || (editingWin && "min" in editingWin))
              ? () => {
                  setFastStep(editingFast);
                  setEditing(null);
                }
              : undefined
          }
          onClose={() => setEditing(null)}
          onSaved={(value) => {
            onChange({ ...e, lifecycle: e.lifecycle.map((s) => (s.key === editing.key ? { ...s, value } : s)) });
            setEditing(null);
          }}
        />
      )}

      <TopBar back={{ label: backLabel, onClick: onBack }} />
      <Title eyebrow={<span className="font-mono">OK #{e.okla}</span>}>{e.building}</Title>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Pill tone={swOn ? "green" : "red"} dot>
          {swOn ? "Running" : "Paused"}
        </Pill>
        <Pill>Due {e.due || "—"}</Pill>
        <DueDot days={daysUntil(e.due)} fallback="" />
      </div>

      {/* What to do next — where a tapped phone alert lands you */}
      {steps.length > 0 && (
        <div className="mt-6 flex flex-col gap-3">
          {steps.map((s) => (
            <Glass pad key={s.title} className="ring-2 ring-accent/25">
              <div className="text-sm font-medium text-accent-ink">Next step</div>
              <div className="mt-0.5 text-lg font-bold tracking-tight">{s.title}</div>
              <p className="mt-1 text-[15px] text-ink-2">{s.text}</p>
              {s.actions.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2.5">
                  {s.actions.map((a, i) =>
                    a.href ? (
                      <a key={a.label} href={a.href} className={"btn min-w-[8rem] flex-1 " + (i === 0 ? "btn-primary" : "btn-secondary")}>
                        {a.label}
                      </a>
                    ) : (
                      <Button key={a.label} variant={i === 0 ? "primary" : "secondary"} className="min-w-[8rem] flex-1" onClick={a.onClick}>
                        {a.label}
                      </Button>
                    ),
                  )}
                </div>
              )}
            </Glass>
          ))}
        </div>
      )}
      {!steps.some((s) => s.startsReport) &&
        (inspectWhy(e) === null ? (
          <Button full variant={steps.length ? "secondary" : "primary"} onClick={onStartReport} className="mt-4">
            Start inspection
          </Button>
        ) : (
          <>
            <Button full variant="secondary" disabled className="mt-4">
              Start inspection
            </Button>
            <p className="mt-1.5 px-1 text-sm text-ink-3">Opens once the visit is booked — {inspectWhy(e)}.</p>
          </>
        ))}
      {/* The newest finished report, in Google Drive (only once there is one). */}
      {e.lastReport && (
        <a href={e.lastReport} target="_blank" rel="noopener noreferrer" className="btn btn-secondary mt-2.5 w-full">
          Last report
        </a>
      )}
      {/* The dashboard's Notes — including each finished report's field notes. */}
      {e.notes?.trim() && (
        <Glass pad className="mt-2.5">
          <div className="text-sm font-medium text-ink-2">Notes</div>
          <p className="mt-1 whitespace-pre-wrap text-[15px] leading-snug">{e.notes.trim()}</p>
        </Glass>
      )}

      {/* Fast track: the steps already set (tap one to change or cancel it), and a
          shortcut to the next step that still needs a time. Each step can also be
          set from its own line in the Customer lifecycle list below. */}
      {fastSet.length > 0 && (
        <Glass pad className="mt-2.5">
          <div className="text-sm font-medium text-accent-ink">Fast track set</div>
          <div className="mt-1 flex flex-col">
            {fastSet.map((k) => (
              <button key={k} onClick={() => setFastStep(k)} className="flex justify-between gap-3 py-1.5 text-left text-[15px]">
                <span>{FAST_STEPS[k].label}</span>
                <span className="text-ink-2">{whenText(fastTimes[k]!)}</span>
              </button>
            ))}
          </div>
          <p className="mt-1 text-sm text-ink-3">Each goes within 15 minutes of its time, any hour. Tap one to change it.</p>
        </Glass>
      )}
      {"step" in fastNext ? (
        <Button full variant="secondary" onClick={() => setFastStep(fastNext.step)} className="mt-2.5">
          {fastSet.length ? `Fast track next: ${FAST_STEPS[fastNext.step].label}` : "Access fast track"}
        </Button>
      ) : (
        fastNext.none &&
        stage(e, "visit") !== "Inspected" && <p className="mt-2.5 px-1 text-sm text-ink-3">Fast track: {fastNext.none}</p>
      )}
      {fastStep && (
        <FastTrackSheet
          elevator={e}
          step={fastStep}
          onClose={() => setFastStep(null)}
          onSaved={(ft) => {
            onChange({ ...e, fastTrack: ft });
            setFastStep(null);
          }}
        />
      )}

      <SectionLabel>Customer lifecycle</SectionLabel>
      <Glass className="px-4 py-1.5">
        {e.lifecycle.filter((s) => looks.has(s.key)).map((s) => {
          const { look: state, note } = looks.get(s.key)!;
          const fk = fastStepForStage(s.key);
          const ft = fk ? fastTimes[fk] : undefined;
          return (
            <button
              key={s.key}
              onClick={() => {
                if (s.locked) return setLockedTap(s.label);
                setLockedTap("");
                setEditing(s);
              }}
              aria-label={`${s.label}: ${s.value || "not yet"}${s.locked ? " (set automatically)" : " — tap to change"}`}
              className={"tl-step " + state}
            >
              <span className="tl-node">{state === "tl-done" && <CheckIcon />}</span>
              <span className={"flex-1 text-[15px] " + (state === "tl-todo" ? "text-ink-3" : "")}>{s.label}</span>
              <span className="text-right text-[13px] text-ink-2">
                {note}
                {ft && <span className="block text-accent-ink">Fast track {whenText(ft)}</span>}
              </span>
            </button>
          );
        })}
      </Glass>
      {lockedTap && (
        <p className="mt-2 px-1 text-sm font-semibold text-accent-ink" role="status">
          {lockedTap} is set automatically once the finished report has been emailed — there&apos;s nothing to change by hand.
        </p>
      )}
      <p className="mt-2 px-1 text-sm text-ink-3">
        Green check = done · green ring = waiting on someone · gray = not yet. Tap a step to change it — you&apos;ll confirm before it saves. Report is set automatically once the
        finished report has been emailed.
      </p>

      <SectionLabel>Safety test</SectionLabel>
      <List>
        <div className="row justify-between">
          <div className="min-w-0">
            <div className="text-[15px]">
              {e.safetyTest === "Yes"
                ? `Passed${e.safetyTestDate ? ` on ${humanDate(e.safetyTestDate)}` : ""}`
                : e.safetyTest === "No"
                  ? "No passing test in the last 12 months"
                  : "Not answered yet"}
            </div>
            <div className="text-sm text-ink-3">
              {isAmerican(e.maintCo) ? "Asked of American Elevator" : "Asked of the customer"} · or call {APRIL.name}{" "}
              {APRIL.phone}
            </div>
          </div>
          <Button variant="soft" className="shrink-0 px-4 py-2.5 text-sm" onClick={() => setEnteringSafety(true)}>
            {e.safetyTest ? "Change" : "Enter"}
          </Button>
        </div>
      </List>
      {enteringSafety && (
        <SafetyEditor
          elevator={e}
          onClose={() => setEnteringSafety(false)}
          onSaved={(next) => {
            onChange(next);
            setEnteringSafety(false);
          }}
        />
      )}

      <SectionLabel>This elevator</SectionLabel>
      <List>
        <div className="row justify-between">
          <div>
            <div className="text-[15px]">Automatic steps</div>
            <div className="text-sm text-ink-3">
              {swOn ? "Emails, invoice and payment steps run" : "Paused — nothing automatic runs"}
            </div>
          </div>
          <Toggle label="Automatic steps" on={swOn} onClick={() => setSwStep(swOn ? "pause1" : "resume")} />
        </div>
        <div className="row justify-between">
          <div>
            <div className="text-[15px]">Quote and PO first</div>
            <div className="text-sm text-ink-3">
              {quotePO ? "Price quote email and purchase order before the visit" : "Invoice only — no quote or PO"}
            </div>
          </div>
          <Toggle label="Quote and PO first" on={quotePO} onClick={() => { setQpErr(""); setQpStep(!quotePO); }} />
        </div>
      </List>
      {qpStep !== null && (
        <ConfirmDialog
          title={qpStep ? `Quote and PO for ${e.building}?` : `Make ${e.building} invoice only?`}
          confirmLabel={qpStep ? "Turn on" : "Make invoice only"}
          busyLabel="Saving…"
          busy={qpBusy}
          error={qpErr}
          onCancel={() => setQpStep(null)}
          onConfirm={() => setQuotePO(qpStep)}
        >
          {qpStep
            ? "The price quote email and the purchase order step come back for this elevator."
            : "The price quote email and the purchase order step go away for this elevator — it's billed after the visit."}
        </ConfirmDialog>
      )}
      {swErr && !swStep && <p className="mt-2 px-1 text-sm font-semibold text-danger">{swErr}</p>}

      {/* pausing takes two confirmations; resuming takes one */}
      {swStep === "pause1" && (
        <ConfirmDialog
          danger
          title={`Pause ${e.building}?`}
          confirmLabel="Continue"
          onCancel={closeSw}
          onConfirm={() => setSwStep("pause2")}
        >
          Its automatic emails, invoice, and payment steps stop until you switch it back on. You&apos;ll confirm once
          more.
        </ConfirmDialog>
      )}
      {swStep === "pause2" && (
        <ConfirmDialog
          danger
          title="Confirm pause"
          confirmLabel="Pause it"
          busyLabel="Pausing…"
          busy={swBusy}
          error={swErr}
          onCancel={closeSw}
          onConfirm={() => setSwitch(false)}
        >
          Pause <span className="font-semibold text-ink">{e.building}</span> now?
        </ConfirmDialog>
      )}
      {swStep === "resume" && (
        <ConfirmDialog
          title={`Resume ${e.building}?`}
          confirmLabel="Resume"
          busyLabel="Resuming…"
          busy={swBusy}
          error={swErr}
          onCancel={closeSw}
          onConfirm={() => setSwitch(true)}
        >
          Automatic steps start running again for this elevator.
        </ConfirmDialog>
      )}

      <SectionLabel>Customer</SectionLabel>
      <List>
        <InfoRow label="Account">{e.account || "—"}</InfoRow>
        <InfoRow label="Contact">{e.contact || "—"}</InfoRow>
        <InfoRow label="Phone">{e.phone ? <a className="text-accent-ink" href={`tel:${e.phone}`}>{e.phone}</a> : "—"}</InfoRow>
        <InfoRow label="Email">{e.email ? <a className="text-accent-ink" href={`mailto:${e.email}`}>{e.email}</a> : "—"}</InfoRow>
      </List>

      <SectionLabel>Maintenance company</SectionLabel>
      <List>
        <InfoRow label="Company">{e.maintCo || "—"}</InfoRow>
        <InfoRow label="Contact">{e.maintContact || "—"}</InfoRow>
        <InfoRow label="Phone">{e.maintPhone ? <a className="text-accent-ink" href={`tel:${e.maintPhone}`}>{e.maintPhone}</a> : "—"}</InfoRow>
        <InfoRow label="Email">{e.maintEmail ? <a className="text-accent-ink" href={`mailto:${e.maintEmail}`}>{e.maintEmail}</a> : "—"}</InfoRow>
      </List>

      <SectionLabel>Details</SectionLabel>
      <List>
        <InfoRow label="City">{[e.city, e.area].filter(Boolean).join(" · ") || "—"}</InfoRow>
        <InfoRow label="Type">{[e.type, e.floors ? `${e.floors} floors` : ""].filter(Boolean).join(" · ") || "—"}</InfoRow>
        <InfoRow label="Cycle">{e.cycle === "Res" ? "Residential" : `Every ${e.cycle === "1" ? "year" : `${e.cycle} years`}`}</InfoRow>
        <InfoRow label="Price">{e.price || formatPrice(computePrice(e.type, e.floors))}</InfoRow>
        <InfoRow label="Money path">{e.moneyPath || "—"}</InfoRow>
      </List>

      <SectionLabel>For the state form</SectionLabel>
      <List>
        {(() => {
          const filled = e.carried.filter((c) => c.value);
          const missing = e.carried.length - filled.length;
          return (
            <div className="row justify-between">
              <div className="min-w-0">
                <div className="text-[15px]">
                  {filled.length ? filled.slice(0, 2).map((c) => `${c.label} ${c.value}`).join(" · ") : "Nothing filled in yet"}
                </div>
                <div className="text-sm text-ink-3">
                  {missing ? `${missing} of ${e.carried.length} details still blank on the report` : "All details filled in"}
                </div>
              </div>
              <Button variant="soft" className="shrink-0 px-4 py-2.5 text-sm" onClick={() => setEditingTech(true)}>
                Edit
              </Button>
            </div>
          );
        })()}
      </List>
      {editingTech && (
        <TechEditor
          elevator={e}
          onClose={() => setEditingTech(false)}
          onSaved={(next) => {
            onChange(next);
            setEditingTech(false);
          }}
        />
      )}
    </Screen>
  );
}

/* ---------- report ---------- */

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
    <Sheet onClose={onClose}>
      <div className="sheet-header">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[21px] font-bold tracking-tight">Violation list</h3>
          <Button variant="quiet" onClick={onClose} className="text-base">
            Done
          </Button>
        </div>
        <input className="input" placeholder="Search the list" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <p className="my-3 rounded-control bg-fill p-3 text-sm leading-relaxed text-ink-2">{VHEAD}</p>
      <div className="flex flex-col gap-2">
        {list.map((raw) => {
          const p = parseViolation(raw);
          const picked = addedRaws.has(raw);
          return (
            <button
              key={raw}
              onClick={() => onToggle(raw)}
              className={"tile p-3.5 text-left text-[15px] " + (picked ? "tile-on" : "")}
            >
              <div className="flex items-start justify-between gap-2">
                <span>{p.text}</span>
                {picked && <span className="shrink-0 text-xs font-semibold text-accent-ink">Added</span>}
              </div>
              <code className="mt-1 block font-mono text-xs text-ink-3">{p.code}</code>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}


function Report({
  elevator,
  onBack,
  onDone,
}: {
  elevator: Elevator;
  onBack: () => void;
  onDone: () => void; // after finishing: back to the main screen
}) {
  // Start from a draft saved earlier on this phone, if there is one.
  const [saved] = useState(() => loadDraft(elevator.okla));
  const [start] = useState<ReportDraft>(() => saved ?? freshReport(elevator));
  const [r, setR] = useState<ReportDraft>(start);
  const [sheet, setSheet] = useState(false);
  const [status, setStatus] = useState(saved ? "Picked up the draft you saved on this phone." : "");
  const [busy, setBusy] = useState(false);
  // Once Finish has worked: where to view the report (its Drive page; the PDF
  // itself only if Drive failed). Finish can't be tapped again after this.
  const [finished, setFinished] = useState<{ view: string } | null>(null);

  const set = <K extends keyof ReportDraft,>(k: K, v: ReportDraft[K]) => setR((p) => ({ ...p, [k]: v }));
  // A temporary certificate means no certificate is issued (as on Robert's own
  // reports), so picking one sets the other. Red Tag / Scrapped / Inactive means
  // no certificate of either kind, so picking a certificate clears that condition
  // (to be picked again) — only one of fail or pass can be on (Robert, 2026-10-28).
  const clearFailed = (c: string) => (noCertificate(c) ? "" : c);
  function pickCert(v: string) {
    setR((p) => ({ ...p, certIssue: v, tempCert: v === "Yes" ? "No" : p.tempCert, condition: v === "Yes" ? clearFailed(p.condition) : p.condition }));
  }
  function pickTemp(v: string) {
    setR((p) => ({ ...p, tempCert: v, certIssue: v === "No" ? p.certIssue : "No", condition: v === "No" ? p.condition : clearFailed(p.condition) }));
  }
  // The elevator's details the state form needs that are still blank (see
  // missingForForm in lib/tech.ts) — filled in right here, saved to the dashboard.
  const needDetails = missingForForm(elevator, elevator.carried);
  const [fillDetails, setFillDetails] = useState(false);
  // Every answer is kept on this phone as it's typed, so a reload (or the app
  // closing) never loses it. Cleared once the report is finished and saved.
  // Nothing is kept until something is typed: an opened-and-closed report must
  // not leave a stale draft that hides answers entered since (e.g. the safety test).
  useEffect(() => {
    if (finished || r === start) return;
    try {
      localStorage.setItem(draftKey(elevator.okla), JSON.stringify(r));
    } catch {
      /* storage may be unavailable */
    }
  }, [r, start, finished, elevator.okla]);
  // "No adverse conditions" = no violations: picking it removes any (after asking
  // once if there are some), and violations can't be added while it's picked.
  const noAdverse = r.condition === "No adverse conditions";
  const [confirmClear, setConfirmClear] = useState(false);
  function pickCondition(v: string) {
    if (v === "No adverse conditions" && r.added.length > 0) setConfirmClear(true);
    // Red Tag / Scrapped / Inactive: no certificate of either kind.
    else if (noCertificate(v)) setR((p) => ({ ...p, condition: v, certIssue: "No", tempCert: "No" }));
    else set("condition", v);
  }

  const addedRaws = useMemo(() => new Set(r.added.map((a) => a.raw)), [r.added]);
  const tally = useMemo(
    () => ({
      V: r.added.length,
      R: (r.recommendations ?? []).length,
      C: (r.comments ?? []).length,
    }),
    [r.added, r.recommendations, r.comments],
  );

  function toggleViolation(raw: string) {
    setR((p) => {
      if (p.added.some((a) => a.raw === raw)) {
        return { ...p, added: p.added.filter((a) => a.raw !== raw) };
      }
      const parsed = parseViolation(raw);
      return {
        ...p,
        added: [...p.added, { raw, kind: "V", violation: parsed.text, comment: "" }],
      };
    });
  }

  // A typed recommendation or comment: { kind, index } — index -1 = a new one.
  const [noteEdit, setNoteEdit] = useState<{ kind: "R" | "C"; index: number } | null>(null);
  const noteList = (k: "R" | "C") => (k === "R" ? (r.recommendations ?? []) : (r.comments ?? []));
  function saveNote(k: "R" | "C", index: number, text: string | null) {
    setR((p) => {
      const list = [...(k === "R" ? (p.recommendations ?? []) : (p.comments ?? []))];
      if (text === null) list.splice(index, 1);
      else if (index < 0) list.push(text);
      else list[index] = text;
      return k === "R" ? { ...p, recommendations: list } : { ...p, comments: list };
    });
    setNoteEdit(null);
  }
  // Lines the state form will get (it has 36): each violation, each violation's
  // comment, each recommendation, each comment — a long one takes more than one.
  const formLineCount = formLines(r).lines.length;

  function setLine(raw: string, patch: Partial<AddedViolation>) {
    setR((p) => ({
      ...p,
      added: p.added.map((a) => (a.raw === raw ? { ...a, ...patch } : a)),
    }));
  }

  // What Finish needs before it can build the report. Tapping Finish with any of
  // these empty marks each one red ("— needed") and scrolls to the first.
  // Test dates: the one-year test on every report except an inactive/scrapped
  // elevator; the five-year test only on cable (traction) elevators.
  const outOfService = r.condition === "Inactive" || r.condition === "Scrapped";
  const isCable = elevator.carried.find((c) => c.label === "Machine type")?.value === "Cable";
  const required: { key: string; label: string; empty: boolean }[] = [
    { key: "date", label: "Date inspected", empty: !r.date },
    { key: "inspType", label: "Inspection type", empty: !r.inspType },
    { key: "cycle", label: "Inspection cycle", empty: !r.cycle },
    { key: "test1", label: "One-year test", empty: !outOfService && !r.test1.trim() },
    { key: "test1", label: `One-year test (${monthYearProblem(r.test1)})`, empty: !!r.test1.trim() && !!monthYearProblem(r.test1) },
    { key: "test5", label: "Five-year test", empty: !outOfService && isCable && !r.test5.trim() },
    { key: "test5", label: `Five-year test (${monthYearProblem(r.test5)})`, empty: !!r.test5.trim() && !!monthYearProblem(r.test5) },
    { key: "certIssue", label: "Certificate issued", empty: !r.certIssue },
    { key: "condition", label: "Condition", empty: !r.condition },
    {
      key: "condition",
      label: `${r.condition} can't have a certificate`,
      empty: noCertificate(r.condition) && (r.certIssue === "Yes" || (!!r.tempCert && r.tempCert !== "No")),
    },
    { key: "violations", label: "At least one violation", empty: r.condition === "Violations found" && r.added.length === 0 },
    { key: "violations", label: "36 lines or fewer for the state form", empty: formLineCount > 36 },
    {
      key: "details",
      label: `${needDetails.length} elevator ${needDetails.length === 1 ? "detail" : "details"} for the state form`,
      empty: needDetails.length > 0,
    },
  ];
  const [showMissing, setShowMissing] = useState(false);
  const missing = new Set(showMissing ? required.filter((q) => q.empty).map((q) => q.key) : []);

  async function finalize() {
    const gaps = required.filter((q) => q.empty);
    if (gaps.length) {
      setShowMissing(true);
      setStatus(`Still needed: ${gaps.map((g) => g.label).join(", ")}.`);
      document.getElementById(`req-${gaps[0].key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setShowMissing(false);
    setBusy(true);
    setStatus("Building the report PDF…");
    try {
      const res = await call(
        "/api/finalize",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ elevator, report: r }) },
        120_000, // builds the PDF and saves it to Drive
      );
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || `Server error ${res.status}`);
      }
      const writeback = res.headers.get("X-Writeback") || "";
      const drive = res.headers.get("X-Drive") || "";
      const driveLink = res.headers.get("X-Drive-Link") || "";
      // View it in Drive (it shows every filled-in box; a phone's raw PDF viewer
      // can show the boxes blank). The PDF itself only if Drive didn't save it.
      const blob = await res.blob();
      const allSaved = writeback === "ok" && drive === "ok";
      if (allSaved) setFinished({ view: driveLink || URL.createObjectURL(blob) });
      try {
        // Keep the answers on this phone unless EVERYTHING saved — so tapping
        // Finish again (after fixing the cause) doesn't mean typing it all again.
        if (allSaved) localStorage.removeItem(draftKey(elevator.okla));
        else localStorage.setItem(draftKey(elevator.okla), JSON.stringify(r));
      } catch {
        /* storage may be unavailable */
      }
      buzz();
      void refreshRoster(); // Visit → Inspected now shows on every tab
      setStatus(
        allSaved
          ? `Finished ${elevator.building}. The report goes to the customer and the state automatically.`
          : drive !== "ok"
            ? `Couldn't save the report to Google Drive, so it can't be emailed yet. Your answers are kept on this phone. ${
                /invalid_grant|unauthorized|401/i.test(drive)
                  ? "Open Settings → Connect Google Drive, then tap Finish again."
                  : "Tap Finish again in a minute."
              }`
            : `The report was saved, but the dashboard couldn't be updated. Your answers are kept on this phone — tap Finish again in a minute.`,
      );
    } catch (err) {
      setStatus("Couldn't build the PDF: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }
  // Keeps the draft on this phone only; reopening this elevator's report picks it back up.
  function saveForLater() {
    try {
      localStorage.setItem(draftKey(elevator.okla), JSON.stringify(r));
      buzz();
      setStatus(`Saved on this phone — reopen ${elevator.building}'s report to pick up where you left off.`);
    } catch {
      setStatus("Couldn't save on this phone (storage is unavailable).");
    }
  }

  return (
    <>
      {sheet && <ViolationSheet addedRaws={addedRaws} onToggle={toggleViolation} onClose={() => setSheet(false)} />}
      {fillDetails && (
        <MissingDetailsSheet
          elevator={elevator}
          need={needDetails.map((d) => d.key)}
          onClose={() => setFillDetails(false)}
          onSaved={(next) => {
            patchElevator(next); // the report (and profile) show it right away
            setFillDetails(false);
          }}
        />
      )}
      {noteEdit && (
        <NoteSheet
          kind={noteEdit.kind}
          initial={noteEdit.index >= 0 ? noteList(noteEdit.kind)[noteEdit.index] : ""}
          isNew={noteEdit.index < 0}
          onClose={() => setNoteEdit(null)}
          onSave={(t) => saveNote(noteEdit.kind, noteEdit.index, t)}
          onDelete={() => saveNote(noteEdit.kind, noteEdit.index, null)}
        />
      )}
      {confirmClear && (
        <ConfirmDialog
          danger
          title="No adverse conditions?"
          confirmLabel={`Remove ${tally.V} ${tally.V === 1 ? "violation" : "violations"}`}
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setR((p) => ({ ...p, condition: "No adverse conditions", added: [] }));
            setConfirmClear(false);
          }}
        >
          This report has {tally.V} {tally.V === 1 ? "violation" : "violations"}. Picking &quot;No adverse conditions&quot; removes
          {tally.V === 1 ? " it" : " them"}.
        </ConfirmDialog>
      )}

      <Screen bottomSpace>
        <TopBar back={{ label: "Profile", onClick: onBack }} />
        <Title eyebrow={<>Inspection report · <span className="font-mono">OK #{elevator.okla}</span></>}>
          {elevator.building}
        </Title>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Pill>Due {elevator.due || "—"}</Pill>
          <DueDot days={daysUntil(elevator.due)} fallback="" />
        </div>

        <SectionLabel>This visit</SectionLabel>
        <Glass pad>
          <Field label="Date inspected" id="req-date" missing={missing.has("date")}>
            <input type="date" className="input" value={r.date} onChange={(e) => set("date", e.target.value)} />
          </Field>
          <Field label="Inspection type" id="req-inspType" missing={missing.has("inspType")}>
            <Chips options={INSPECTION_TYPES} value={r.inspType} onChange={(v) => set("inspType", v)} />
          </Field>
          <Field label="Inspection cycle" id="req-cycle" missing={missing.has("cycle")}>
            <Chips options={CYCLES} value={r.cycle} onChange={(v) => set("cycle", v)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="One-year test" id="req-test1" missing={missing.has("test1")}>
              <input className="input" placeholder="MM/YYYY" inputMode="numeric" maxLength={7} value={r.test1} onChange={(e) => set("test1", typeMonthYear(e.target.value))} />
            </Field>
            <Field label={isCable ? "Five-year test" : "Five-year test (cable only)"} id="req-test5" missing={missing.has("test5")}>
              <input className="input" placeholder="MM/YYYY" inputMode="numeric" maxLength={7} value={r.test5} onChange={(e) => set("test5", typeMonthYear(e.target.value))} />
            </Field>
          </div>
          <Field label="Certificate issued" id="req-certIssue" missing={missing.has("certIssue")}>
            <Chips options={CERT_ISSUE} value={r.certIssue} onChange={pickCert} />
          </Field>
          <Field label="Temporary certificate of operation">
            <Chips options={TEMP_CERT} value={r.tempCert || "No"} onChange={pickTemp} />
          </Field>
          <Field label="Condition" id="req-condition" missing={missing.has("condition")}>
            <Chips options={CONDITIONS} value={r.condition} onChange={pickCondition} />
            {noCertificate(r.condition) && (
              <p className="mt-2 text-sm text-ink-3">
                {r.condition}: no certificate{noDueDate(r.condition) ? ", and no next due date is set" : ""}.
              </p>
            )}
          </Field>
        </Glass>

        <SectionLabel>Findings</SectionLabel>
        <Glass pad className={missing.has("violations") ? "ring-2 ring-danger/50" : ""}>
          <div id="req-violations" className="scroll-mt-24" />
          {missing.has("violations") && r.added.length === 0 && (
            <p className="mb-3 text-sm font-semibold text-danger">&quot;Violations found&quot; is picked — add at least one violation.</p>
          )}
          {/* The three counters are the buttons: violations open the list; a
              recommendation or comment opens a box to type it in. */}
          <div className="grid grid-cols-3 gap-2.5">
            <Tally n={tally.V} label="Violations" tone="text-danger" onClick={() => setSheet(true)} disabled={noAdverse} />
            <Tally n={tally.R} label="Recommend" tone="text-warn" onClick={() => setNoteEdit({ kind: "R", index: -1 })} />
            <Tally n={tally.C} label="Comments" tone="text-ink-2" onClick={() => setNoteEdit({ kind: "C", index: -1 })} />
          </div>
          {noAdverse && (
            <p className="mt-2 text-center text-sm text-ink-3">
              &quot;No adverse conditions&quot; is picked — pick &quot;Violations found&quot; above to add violations.
            </p>
          )}
          {formLineCount > 36 && (
            <p className="mt-2 text-sm font-semibold text-danger">
              The state form has 36 lines — this report needs {formLineCount}. Remove or combine some.
            </p>
          )}

          {r.added.length > 0 && <div className="mt-5 text-sm font-medium text-ink-2">Violations</div>}
          <div className="mt-2 flex flex-col gap-3">
            {r.added.map((a) => (
              <div key={a.raw} className="finding">
                <div className="flex items-start gap-3 px-3.5 pt-3">
                  <p className="flex-1 text-[15px] leading-snug">{a.violation}</p>
                  <button onClick={() => toggleViolation(a.raw)} className="text-sm font-semibold text-danger">
                    Remove
                  </button>
                </div>
                <code className="block px-3.5 pb-2 pt-1 font-mono text-xs text-ink-3">{parseViolation(a.raw).code}</code>
                <textarea
                  className="w-full resize-none bg-fill px-3.5 py-2.5 text-[15px] outline-none placeholder:text-ink-3"
                  rows={2}
                  placeholder="Comment on this violation (optional)"
                  value={a.comment}
                  onChange={(e) => setLine(a.raw, { comment: e.target.value })}
                />
              </div>
            ))}
          </div>

          {(["R", "C"] as const).map((k) =>
            noteList(k).length > 0 ? (
              <div key={k}>
                <div className="mt-5 text-sm font-medium text-ink-2">{k === "R" ? "Recommendations" : "Comments"}</div>
                <div className="mt-2 flex flex-col gap-2.5">
                  {noteList(k).map((t, i) => (
                    <button
                      key={i}
                      onClick={() => setNoteEdit({ kind: k, index: i })}
                      className={"finding finding-" + k + " px-3.5 py-3 text-left text-[15px] leading-snug"}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ) : null,
          )}
          {r.added.length + tally.R + tally.C === 0 && (
            <p className="mt-4 text-center text-sm text-ink-3">None added yet — tap a counter above.</p>
          )}
        </Glass>

        <SectionLabel>Field notes</SectionLabel>
        <Glass pad>
          <Field label="Anything to fix on the computer later (saved to the elevator's notes, not printed on the report)">
            <textarea
              className="input min-h-24 resize-y"
              placeholder="Owner changed hands, serial on file is wrong, new gate code…"
              value={r.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </Glass>

        <SectionLabel>Carried over</SectionLabel>
        <div id="req-details" className="scroll-mt-24" />
        {needDetails.length > 0 && (
          <Glass pad className={"mb-3 " + (missing.has("details") ? "ring-2 ring-danger/50" : "")}>
            <p className={"text-[15px] font-semibold " + (missing.has("details") ? "text-danger" : "")}>
              {needDetails.length} {needDetails.length === 1 ? "detail is" : "details are"} still blank for the state form
            </p>
            <p className="mt-1 text-sm text-ink-3">{needDetails.map((d) => d.label).join(", ")}</p>
            <Button full className="mt-3" onClick={() => setFillDetails(true)}>
              Fill them in
            </Button>
          </Glass>
        )}
        <List>
          {FORM_BASICS.map((b) => (
            <InfoRow key={b.key} label={b.label}>
              {elevator[b.key] || <span className={missing.has("details") ? "font-semibold text-danger" : ""}>— needed</span>}
            </InfoRow>
          ))}
          {elevator.carried.map((f) => (
            <InfoRow key={f.label} label={f.label}>
              {f.value ||
                (needDetails.some((d) => d.label === f.label) ? (
                  <span className={missing.has("details") ? "font-semibold text-danger" : ""}>— needed</span>
                ) : (
                  "—"
                ))}
            </InfoRow>
          ))}
        </List>
        <p className="mt-2 px-1 text-sm text-ink-3">
          Saved with the elevator, so every report has them. To change a filled-in one, go back to the elevator&apos;s
          profile → For the state form → Edit.
        </p>
      </Screen>

      {/* floating action bar */}
      <div className="floating-bar glass-strong">
        {status && <p className="px-2 pb-2 pt-1 text-[13px] text-ink-2">{status}</p>}
        {finished ? (
          <div className="flex gap-2.5">
            <a href={finished.view} target="_blank" rel="noopener noreferrer" className="btn btn-secondary flex-1">
              View report
            </a>
            <Button onClick={onDone} className="flex-1">
              Done
            </Button>
          </div>
        ) : (
          <div className="flex gap-2.5">
            <Button variant="secondary" onClick={saveForLater} disabled={busy} className="flex-1">
              Save for later
            </Button>
            <Button onClick={finalize} disabled={busy} className="flex-1">
              {busy ? "Working…" : "Finish report"}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function Tally({ n, label, tone, onClick, disabled }: { n: number; label: string; tone: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-control bg-fill py-2.5 text-center transition-transform active:scale-95 disabled:opacity-40"
      aria-label={`${label}: ${n} — tap to add`}
    >
      <div className={"text-2xl font-bold tabular-nums tracking-tight " + tone}>{n}</div>
      <div className="text-xs text-ink-2">{label}</div>
      <div className="mt-0.5 text-[11px] font-semibold text-accent-ink">+ Add</div>
    </button>
  );
}

// Type a recommendation or comment for the report (it prints as its own line on
// the state form). Tapping an existing one reopens it to change or delete.
function NoteSheet({
  kind,
  initial,
  isNew,
  onClose,
  onSave,
  onDelete,
}: {
  kind: "R" | "C";
  initial: string;
  isNew: boolean;
  onClose: () => void;
  onSave: (text: string) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(initial);
  const what = kind === "R" ? "recommendation" : "comment";
  return (
    <Sheet onClose={onClose}>
      <h3 className="text-[21px] font-bold tracking-tight">{isNew ? `Add a ${what}` : `Change ${what}`}</h3>
      <textarea
        className="input mt-4 min-h-28 resize-y"
        placeholder={kind === "R" ? "e.g. Replace worn hoist ropes within the year" : "e.g. Machine room was clean and well lit"}
        value={text}
        maxLength={300}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <div className="mt-5 flex flex-col gap-2.5">
        <Button full onClick={() => onSave(text.trim())} disabled={!text.trim()}>
          Save
        </Button>
        {!isNew && (
          <Button variant="secondary" full onClick={onDelete}>
            Delete it
          </Button>
        )}
        <Button variant="secondary" full onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}

/* ---------- root ---------- */

// True only in the phone's browser. The app screen is drawn there, not on the
// server first: the server runs on a different clock and time zone, so things
// like "Good afternoon" and today's date came out differently and React threw a
// mismatch error on every load (found by break-testing).
const noop = () => () => {};
const useOnPhone = () => useSyncExternalStore(noop, () => true, () => false);

export default function Home() {
  const onPhone = useOnPhone();
  return onPhone ? <App /> : <div className="min-h-dvh" />;
}

function App() {
  const { signOut } = useClerk();
  const roster = useRoster();
  // A summary alert links to /?tab=today; otherwise start on Today too.
  const [tab, setTab] = useState<Tab>(() => {
    const t = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("tab");
    return (["today", "elevators", "money", "settings"] as string[]).includes(t ?? "") ? (t as Tab) : "today";
  });
  const [stage, setStage] = useState<Stage>("tabs");
  const [selected, setSelected] = useState<Elevator | null>(null);
  // Where each tab was scrolled to, so coming back from an elevator lands you
  // where you were in the list.
  const scrollSpots = useRef<Record<string, number>>({});
  // The address bar always says which screen is open (?tab=… plus &open=<okla>
  // for an elevator, &report=<okla> for its report — see the effect below), so a
  // reload — or a phone alert linking to /?open=<okla> — lands on that screen
  // once the list is available.
  const [openAt, setOpenAt] = useState(() => {
    const q = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
    return { okla: q?.get("report") || q?.get("open") || "", report: !!q?.get("report") };
  });
  if (openAt.okla && roster.accounts) {
    const hit = roster.accounts.flatMap((a) => a.units).find((u) => u.okla === openAt.okla);
    setOpenAt({ okla: "", report: false });
    if (hit) {
      setSelected(hit);
      setStage(openAt.report ? "report" : "profile");
    }
  }
  useEffect(() => {
    if (openAt.okla) return; // still waiting to open the screen from the address
    const q = new URLSearchParams({ tab });
    if ((stage === "profile" || stage === "report") && selected) q.set(stage === "report" ? "report" : "open", selected.okla);
    const url = `${window.location.pathname}?${q}`;
    if (url !== window.location.pathname + window.location.search) window.history.replaceState(null, "", url);
  }, [tab, stage, selected, openAt.okla]);

  // Always ends on the sign-in page — even if Clerk can't be reached (gives it 5s).
  const logout = async () => {
    try {
      await Promise.race([signOut(), new Promise((done) => setTimeout(done, 5000))]);
    } catch {
      /* go anyway */
    }
    window.location.assign(new URL("/sign-in", window.location.origin).href);
  };

  // Every change glides (see go() in components/ui.tsx). Leaving the tabs saves
  // the scroll spot; returning to them restores it; anything else starts at the top.
  const to = (next: Stage, pick?: Elevator) => {
    if (stage === "tabs") scrollSpots.current[tab] = window.scrollY;
    go(
      () => {
        if (pick) setSelected(pick);
        setStage(next);
      },
      () => window.scrollTo(0, next === "tabs" ? (scrollSpots.current[tab] ?? 0) : 0),
    );
  };
  const switchTab = (t: Tab) => {
    if (t === tab && stage === "tabs") return window.scrollTo({ top: 0, behavior: "smooth" }); // tap again = back to top
    if (stage === "tabs") scrollSpots.current[tab] = window.scrollY;
    go(
      () => {
        setTab(t);
        setStage("tabs");
      },
      () => window.scrollTo(0, scrollSpots.current[t] ?? 0),
    );
  };
  const pick = (e: Elevator) => to("profile", e);
  // A saved edit on the profile: keep it on screen and in the phone's copy of the list.
  const changed = (e: Elevator) => {
    setSelected(e);
    patchElevator(e);
  };

  const badge = roster.accounts ? (() => {
    const t = todayLists(roster.accounts);
    return t.needs.length + t.overdue.length;
  })() : 0;
  const TAB_LABEL: Record<Tab, string> = { today: "Today", elevators: "Elevators", money: "Money", settings: "Settings" };
  // The tab bar shows on the tabs and on an elevator's profile; the report and
  // new-elevator screens have their own buttons at the bottom instead.
  const showTabs = stage === "tabs" || stage === "profile";

  // The open elevator, as the latest copy of the list has it — so when a fresh
  // copy arrives from the dashboard, the open profile updates too. (A brand-new
  // elevator isn't in the list until the next refresh, so fall back to `selected`.)
  const live =
    (selected && roster.accounts?.flatMap((a) => a.units).find((u) => u.okla === selected.okla)) || selected;

  let screen: React.ReactNode;
  if (stage === "new") {
    screen = <NewElevator onBack={() => to("tabs")} onCreated={(e) => to("profile", e)} />;
  } else if ((stage === "profile" || (stage === "report" && !!live && inspectWhy(live) !== null)) && live) {
    screen = (
      <Profile
        key={live.okla}
        elevator={live}
        onChange={changed}
        backLabel={TAB_LABEL[tab]}
        onBack={() => to("tabs")}
        onStartReport={() => to("report")}
      />
    );
  } else if (stage === "report" && selected) {
    // The latest copy (live), not the one captured when the elevator was opened —
    // so an answer entered a moment ago (e.g. the safety test) is on the report.
    screen = <Report key={selected.okla} elevator={live ?? selected} onBack={() => to("profile")} onDone={() => to("tabs")} />;
  } else if (tab === "today") {
    screen = <TodayTab accounts={roster.accounts} error={roster.error} onPick={pick} />;
  } else if (tab === "elevators") {
    screen = <ElevatorsTab accounts={roster.accounts} error={roster.error} onPick={pick} onNew={() => to("new")} />;
  } else if (tab === "money") {
    screen = <MoneyTab accounts={roster.accounts} error={roster.error} onPick={pick} />;
  } else {
    screen = <SettingsTab onLogout={logout} />;
  }

  return (
    <>
      {screen}
      {/* Reload, opposite the assistant button — comes back to this same screen. */}
      <button
        type="button"
        onClick={() => window.location.reload()}
        className={"reload-fab glass-strong " + (showTabs ? "ask-fab-tabs" : stage === "report" ? "ask-fab-bar" : "")}
        aria-label="Reload"
      >
        <ReloadIcon />
      </button>
      <AssistantButton
        context={(stage === "profile" || stage === "report") && live ? { okla: live.okla, building: live.building } : null}
        lift={showTabs ? "tabs" : stage === "report" ? "bar" : "none"}
      />
      {showTabs && (
        <TabBar<Tab>
          value={tab}
          onChange={switchTab}
          tabs={[
            { key: "today", label: "Today", icon: <TodayIcon />, badge },
            { key: "elevators", label: "Elevators", icon: <ElevatorsIcon /> },
            { key: "money", label: "Money", icon: <MoneyIcon /> },
            { key: "settings", label: "Settings", icon: <SettingsIcon /> },
          ]}
        />
      )}
    </>
  );
}
