"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { getRoster, getServerRoster, patchElevator, refreshRoster, subscribeRoster } from "@/lib/roster-store";
import { useClerk } from "@clerk/nextjs";
import { getInstallState, subscribeInstall, triggerInstall } from "@/lib/pwa-install";
import { alertsState, enableAlerts, sendTestAlert, type AlertState } from "@/lib/push-client";
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
import { DEVICE_TYPE_CODE, ENTITY_TYPE_CODE, MACHINE_TYPE_CODE } from "@/lib/formCodes";
import { APRIL, WHERE_TO_FIND, isAmerican, toIsoDate } from "@/lib/records";
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

// "$1,175.50" → 1175.5; falls back to the rate card when the cell is empty.
function priceOf(e: Elevator): number {
  const n = Number((e.price ?? "").replace(/[^0-9.]/g, ""));
  return n > 0 ? n : (computePrice(e.type, e.floors) ?? 0);
}
const money = (n: number) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });

// Shown by a tab while the list hasn't arrived yet, or if it can't be reached.
function RosterStatus({ error }: { error: string }) {
  if (!error) return <p className="mt-10 text-center text-sm text-ink-3">Loading your list…</p>;
  return (
    <Glass pad className="mt-6">
      <p className="font-semibold text-danger">Couldn&apos;t load your elevator list.</p>
      <p className="mt-1 text-sm text-ink-2">{error}</p>
      <Button className="mt-4" onClick={() => void refreshRoster()}>
        Try again
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
  condition: string;
  notes: string;
  added: AddedViolation[];
};

// "Save for later" keeps the draft on this phone under this key, one per elevator.
const draftKey = (okla: string) => `eei_draft_${okla}`;

// Read a saved draft back, or null if there isn't a usable one.
function loadDraft(okla: string): ReportDraft | null {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(okla)) || "null") as ReportDraft | null;
    return d && Array.isArray(d.added) ? d : null;
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
    condition: e.lastYear.condition,
    notes: "",
    added: [],
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
  const install = () => {
    void triggerInstall();
  };
  return { installed: state.installed, canInstall: state.canInstall, install };
}

function SettingsTab({ onLogout }: { onLogout: () => void }) {
  const { installed, canInstall, install } = useInstall();
  const [scale, setScale] = useState(currentFontScale);

  // Live master-switch state, so the System card shows on/off at a glance.
  const [master, setMaster] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/switches?only=master") // just the master switch — one small read
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { master?: boolean } | null) => setMaster(d && typeof d.master === "boolean" ? d.master : null))
      .catch(() => setMaster(null));
  }, []);

  // Can the app still save finished reports to Google Drive? (?drive=… is the
  // result of coming back from Google's sign-in page.)
  const [drive, setDrive] = useState<boolean | null>(null);
  const [driveResult] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("drive") || "",
  );
  useEffect(() => {
    fetch("/api/google/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { connected?: boolean } | null) => setDrive(d ? Boolean(d.connected) : null))
      .catch(() => setDrive(null));
  }, []);

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
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState("");
  const runTest = async () => {
    setTestBusy(true);
    const sent = await sendTestAlert();
    setTestResult(
      sent === null
        ? "Couldn't send just now — check your signal and try again."
        : sent === 0
          ? "No phone could be reached. Close and reopen the app, then try again."
          : `Sent to ${sent} ${sent === 1 ? "phone" : "phones"} — it should buzz in a few seconds.`,
    );
    setTestBusy(false);
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

      <SectionLabel>This device</SectionLabel>
      <Glass pad>
        {installed ? (
          <p className="text-[15px]">
            <span className="font-semibold text-accent-ink">Installed</span> — you&apos;re running the app from your
            home screen.
          </p>
        ) : canInstall ? (
          <>
            <p className="mb-3 text-[15px] text-ink-2">Add EEI Field Reports to this phone as an app.</p>
            <Button full onClick={install}>
              Install the app
            </Button>
          </>
        ) : (
          <div className="text-[15px] text-ink-2">
            <p className="mb-2 text-ink">To add EEI Field Reports as an app on this phone:</p>
            <p>1. Tap the ⋮ menu at the top-right of Chrome.</p>
            <p>2. Tap Install app (or Add to Home screen).</p>
            <p className="mt-2 text-sm text-ink-3">
              If neither shows, reload once and reopen Settings — the one-tap button appears here as soon as the
              phone is ready.
            </p>
          </div>
        )}
      </Glass>

      <SectionLabel>Alerts</SectionLabel>
      <Glass pad>
        {alerts === "on" ? (
          <>
            <p className="mb-3 text-[15px] text-ink-2">
              <span className="font-semibold text-accent-ink">Alerts on</span> — you get one summary each morning of
              what needs you (an inspection that&apos;s booked, a safety test still missing, anything past due). During
              the day it only buzzes when something new comes up. Tap an alert to go straight to it.
            </p>
            {testResult && <p className="mb-3 text-sm text-ink-2">{testResult}</p>}
            <Button variant="secondary" full onClick={runTest} disabled={testBusy}>
              {testBusy ? "Sending…" : "Send me a test alert"}
            </Button>
          </>
        ) : alerts === "blocked" ? (
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
          </>
        )}
      </Glass>

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
        <p className="mt-3 text-sm text-ink-3">Each elevator has its own switch on its profile.</p>
      </Glass>

      <SectionLabel>Google Drive</SectionLabel>
      <Glass pad>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[15px]">Saving reports</span>
          {drive === null ? (
            <span className="text-sm text-ink-3">Checking…</span>
          ) : (
            <Pill tone={drive ? "green" : "red"} dot>
              {drive ? "Connected" : "Not connected"}
            </Pill>
          )}
        </div>
        {driveResult === "failed" && (
          <p className="mb-3 text-sm text-danger">That didn&apos;t go through. Try again, and choose Allow on Google&apos;s page.</p>
        )}
        {drive === false && (
          <p className="mb-3 text-[15px] text-ink-2">
            Finished reports can&apos;t be saved to Drive or emailed until you sign in to Google again.
          </p>
        )}
        {/* A full page visit (not a fetch): Google's sign-in page takes over, then comes back here. */}
        <a href="/api/google/connect" className={"btn w-full " + (drive === false ? "btn-primary" : "btn-secondary")}>
          {drive === false ? "Connect Google Drive" : "Reconnect Google Drive"}
        </a>
      </Glass>

      <SectionLabel>Account</SectionLabel>
      <Button variant="secondary" full onClick={onLogout}>
        Log out
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
    <button onClick={() => onPick(u)} className="row">
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
              <button key={u.okla + what} onClick={() => onPick(u)} className="row">
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
    <button onClick={() => onPick(u)} className="row">
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
function MoneyTab({ accounts, error, onPick }: { accounts: Account[] | null; error: string; onPick: (e: Elevator) => void }) {
  if (!accounts) {
    return (
      <Screen bottomSpace>
        <Title eyebrow="This cycle">Money</Title>
        <RosterStatus error={error} />
      </Screen>
    );
  }
  const all = accounts.flatMap((a) => a.units);
  const paid = (u: Elevator) => stage(u, "paid") === "Paid";
  const outstanding = all.filter((u) => stage(u, "invoice") === "Sent" && !paid(u));
  const toBill = all.filter((u) => stage(u, "report") === "Sent" && stage(u, "invoice") !== "Sent" && !paid(u));
  const collected = all.filter(paid);
  const sum = (list: Elevator[]) => list.reduce((n, u) => n + priceOf(u), 0);

  return (
    <Screen bottomSpace>
      <Title eyebrow="This cycle">Money</Title>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Glass pad>
          <div className="text-sm text-ink-2">Waiting on</div>
          <div className="mt-1 text-[26px] font-bold tracking-tight tabular-nums">{money(sum(outstanding))}</div>
          <div className="text-xs text-ink-3">
            {outstanding.length} {outstanding.length === 1 ? "bill" : "bills"} out
          </div>
        </Glass>
        <Glass pad>
          <div className="text-sm text-ink-2">Collected</div>
          <div className="mt-1 text-[26px] font-bold tracking-tight tabular-nums text-accent-ink">{money(sum(collected))}</div>
          <div className="text-xs text-ink-3">{collected.length} paid</div>
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
              <MoneyRow key={u.okla} u={u} onPick={onPick} note="Report filed — invoice going out" />
            ))}
          </List>
        </>
      )}

      <SectionLabel>Paid · {collected.length}</SectionLabel>
      {collected.length > 0 ? (
        <List>
          {collected.map((u) => (
            <MoneyRow key={u.okla} u={u} onPick={onPick} note="Paid — next year's cycle is being set" />
          ))}
        </List>
      ) : (
        <p className="px-1 text-sm text-ink-3">Nothing paid yet this cycle.</p>
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
      <input className="input" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
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

      <SectionLabel>Technical details (for the state form)</SectionLabel>
      <Glass pad>
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
        {busy ? "Saving…" : "Save & start first inspection"}
      </Button>
      <p className="mt-3 px-1 text-sm text-ink-3">
        Adds the elevator to your dashboard, then opens its first inspection so its first report is saved to Drive —
        a new account gets its own Drive folder automatically.
      </p>
    </Screen>
  );
}

/* ---------- profile ---------- */

// Lifecycle values that mean "in progress, waiting on someone" (shown as the
// breathing "now" node); any other value means the step is done.
const IN_PROGRESS = new Set(["Waiting", "Awaiting", "Booked", "Review", "No answer"]);

// Tap a lifecycle step → a sheet to change it; saving asks once more in the same sheet.
function LifecycleEditor({
  stage,
  row,
  okla,
  onClose,
  onSaved,
}: {
  stage: LifecycleStage;
  row?: number;
  okla: string; // sent with the row so the server can check it's still the same elevator
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
        body: JSON.stringify({ row, okla, col: stage.col, value: choice }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || `Error ${res.status}`);
      }
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
          {stage.options.length > 0 ? (
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
function nextSteps(e: Elevator, onStartReport: () => void, onEnterSafety: () => void): NextStep[] {
  const out: NextStep[] = [];
  const visit = stage(e, "visit");
  const trip = stage(e, "tripDay");
  const call = (label: string, phone?: string) => (phone ? [{ label, href: `tel:${phone}` }] : []);
  const mail = (label: string, email?: string, subject?: string) =>
    email ? [{ label, href: `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}` }] : [];

  if (visit === "Booked") {
    const today = daysUntil(trip) === 0;
    out.push({
      title: today ? "You're inspecting this today" : trip ? `Booked for ${humanDate(trip)}` : "A visit is booked",
      text: today ? "When you get there, start the report." : "Everything's set. Start the report when you're on site.",
      actions: [{ label: "Start inspection", onClick: onStartReport }],
      startsReport: true,
    });
  }
  if (stage(e, "maintConfirm") === "Waiting") {
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
        ...call(american ? "Call them" : "Call customer", phone),
        ...mail(american ? "Email them" : "Email customer", email, `Safety test for ${e.building}`),
      ],
    });
  }
  if (visit === "Inspected" && stage(e, "report") !== "Sent") {
    out.push(
      e.reportDone
        ? { title: "Report is on its way", text: "The finished report goes to the customer and the state automatically within the hour.", actions: [] }
        : {
            title: "The report isn't finished",
            text: "The visit is marked done, but no report has been finished for it — so nothing can be sent to the customer or the state yet.",
            actions: [{ label: "Finish report", onClick: onStartReport }],
            startsReport: true,
          },
    );
  }
  const d = daysUntil(e.due);
  if (d !== null && d < 0 && visit !== "Booked" && visit !== "Inspected") {
    out.push({
      title: "Past due",
      text: `It was due ${humanDate(e.due)} and no visit is booked yet.`,
      actions: [...call("Call customer", e.phone), ...mail("Email customer", e.email, `Scheduling the inspection at ${e.building}`)],
    });
  }
  if (stage(e, "invoice") === "Sent" && stage(e, "paid") !== "Paid") {
    const reminder = stage(e, "followUps");
    out.push({
      title: "Waiting on payment",
      text: `The ${e.price || "invoice"} bill is out${reminder ? ` and reminder ${reminder.replace(" sent", "")} has gone out` : ""}. Nothing to do unless it drags on.`,
      actions: call("Call customer", e.phone),
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
    if (elevator.row == null) return setErr("This elevator has no saved row yet.");
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row: elevator.row, okla: elevator.okla, result: answer, date }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(d.error || "Save failed");
      buzz();
      // Show the answer everywhere right away (and move the records step on).
      const [y, m, day] = date.split("-");
      onSaved({
        ...elevator,
        safetyTest: answer as "Yes" | "No",
        safetyTestDate: answer === "Yes" && y ? `${+m}/${+day}/${y}` : "",
        lifecycle: elevator.lifecycle.map((s) => (s.key === "maintConfirm" ? { ...s, value: "Answered" } : s)),
      });
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
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
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

  // This elevator's on/off switch. Pausing takes two confirmations (a warning,
  // then a final yes); resuming takes one.
  const swOn = e.active !== false;
  const [enteringSafety, setEnteringSafety] = useState(false);
  const steps = nextSteps(e, onStartReport, () => setEnteringSafety(true));
  const [swStep, setSwStep] = useState<null | "pause1" | "pause2" | "resume">(null);
  const [swBusy, setSwBusy] = useState(false);
  const [swErr, setSwErr] = useState("");
  const closeSw = () => { setSwStep(null); setSwErr(""); };
  async function setSwitch(next: boolean) {
    if (e.row == null) { setSwErr("This elevator has no saved row yet."); return; }
    setSwBusy(true);
    setSwErr("");
    try {
      const r = await fetch("/api/switches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "elevator", row: e.row, okla: e.okla, on: next }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(d.error || "Save failed");
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
      {!steps.some((s) => s.startsReport) && (
        <Button full variant={steps.length ? "secondary" : "primary"} onClick={onStartReport} className="mt-4">
          Start inspection
        </Button>
      )}

      <SectionLabel>Customer lifecycle</SectionLabel>
      <Glass className="px-4 py-1.5">
        {e.lifecycle.map((s) => {
          const state = !s.value ? "tl-todo" : IN_PROGRESS.has(s.value) ? "tl-now" : "tl-done";
          return (
            <button key={s.key} onClick={() => setEditing(s)} className={"tl-step " + state}>
              <span className="tl-node">{state === "tl-done" && <CheckIcon />}</span>
              <span className={"flex-1 text-[15px] " + (s.value ? "" : "text-ink-3")}>{s.label}</span>
              <span className="text-[13px] text-ink-2">{s.value}</span>
            </button>
          );
        })}
      </Glass>
      <p className="mt-2 px-1 text-sm text-ink-3">Tap a step to change it — you&apos;ll confirm before it saves.</p>

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
      </List>
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

const KIND_LABEL: Record<LineKind, string> = { V: "Violation", R: "Recommend", C: "Comment" };
const KINDS: LineKind[] = ["V", "R", "C"];

function Report({
  elevator,
  onBack,
}: {
  elevator: Elevator;
  onBack: () => void;
}) {
  // Start from a draft saved earlier on this phone, if there is one.
  const [saved] = useState(() => loadDraft(elevator.okla));
  const [r, setR] = useState<ReportDraft>(() => saved ?? freshReport(elevator));
  const [sheet, setSheet] = useState(false);
  const [status, setStatus] = useState(saved ? "Picked up the draft you saved on this phone." : "");
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof ReportDraft,>(k: K, v: ReportDraft[K]) => setR((p) => ({ ...p, [k]: v }));

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
        added: [...p.added, { raw, kind: "V", violation: parsed.text, comment: "" }],
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
      setStatus("Add the inspection date before finishing.");
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
      try {
        localStorage.removeItem(draftKey(elevator.okla)); // finished — the saved draft is no longer needed
      } catch {
        /* storage may be unavailable */
      }
      buzz();
      void refreshRoster(); // Visit → Inspected now shows on every tab
      const dashNote =
        writeback === "ok" ? "Dashboard updated (Visit → Inspected)." : "Dashboard update: " + writeback + ".";
      const driveNote = drive === "ok" ? "Saved to Drive." : "Drive save: " + drive + ".";
      setStatus(`Finished ${elevator.building}. ${dashNote} ${driveNote}`);
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
          <Field label="Date inspected">
            <input type="date" className="input" value={r.date} onChange={(e) => set("date", e.target.value)} />
          </Field>
          <Field label="Inspection type">
            <Chips options={INSPECTION_TYPES} value={r.inspType} onChange={(v) => set("inspType", v)} />
          </Field>
          <Field label="Inspection cycle">
            <Chips options={CYCLES} value={r.cycle} onChange={(v) => set("cycle", v)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="One-year test">
              <input className="input" placeholder="MM/YYYY" value={r.test1} onChange={(e) => set("test1", e.target.value)} />
            </Field>
            <Field label="Five-year test">
              <input className="input" placeholder="MM/YYYY" value={r.test5} onChange={(e) => set("test5", e.target.value)} />
            </Field>
          </div>
          <Field label="Certificate issued">
            <Chips options={CERT_ISSUE} value={r.certIssue} onChange={(v) => set("certIssue", v)} />
          </Field>
          <Field label="Condition">
            <Chips options={CONDITIONS} value={r.condition} onChange={(v) => set("condition", v)} />
          </Field>
        </Glass>

        <SectionLabel>Findings</SectionLabel>
        <Glass pad>
          <div className="grid grid-cols-3 gap-2.5">
            <Tally n={tally.V} label="Violations" tone="text-danger" />
            <Tally n={tally.R} label="Recommend" tone="text-warn" />
            <Tally n={tally.C} label="Comments" tone="text-ink-2" />
          </div>
          {r.added.length === 0 && <p className="mt-4 text-center text-sm text-ink-3">None added yet.</p>}
          <div className="mt-3 flex flex-col gap-3">
            {r.added.map((a) => (
              <div key={a.raw} className={"finding " + (a.kind !== "V" ? "finding-" + a.kind : "")}>
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
                  placeholder="Comment (optional)"
                  value={a.comment}
                  onChange={(e) => setLine(a.raw, { comment: e.target.value })}
                />
                <div className="flex flex-wrap gap-2 px-3 py-2.5">
                  {KINDS.map((k) => (
                    <button
                      key={k}
                      onClick={() => setLine(a.raw, { kind: k })}
                      className={"chip py-1.5 text-[13px] " + (a.kind === k ? "chip-on" : "")}
                    >
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button variant="soft" full onClick={() => setSheet(true)} className="mt-4">
            <PlusIcon />
            Add from the list
          </Button>
        </Glass>

        <SectionLabel>Field notes</SectionLabel>
        <Glass pad>
          <Field label="Anything to fix on the computer later">
            <textarea
              className="input min-h-24 resize-y"
              placeholder="Owner changed hands, serial on file is wrong, new gate code…"
              value={r.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </Glass>

        <SectionLabel>Carried over</SectionLabel>
        <List>
          {elevator.carried.map((f) => (
            <InfoRow key={f.label} label={f.label}>
              {f.value || "—"}
            </InfoRow>
          ))}
        </List>
        <p className="mt-2 px-1 text-sm text-ink-3">
          Locked in the field so nothing changes by accident — note it above and edit it on the computer.
        </p>
      </Screen>

      {/* floating action bar */}
      <div className="floating-bar glass-strong">
        {status && <p className="px-2 pb-2 pt-1 text-[13px] text-ink-2">{status}</p>}
        <div className="flex gap-2.5">
          <Button variant="secondary" onClick={saveForLater} disabled={busy} className="flex-1">
            Save for later
          </Button>
          <Button onClick={finalize} disabled={busy} className="flex-1">
            {busy ? "Working…" : "Finish report"}
          </Button>
        </div>
      </div>
    </>
  );
}

function Tally({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="rounded-control bg-fill py-2.5 text-center">
      <div className={"text-2xl font-bold tabular-nums tracking-tight " + tone}>{n}</div>
      <div className="text-xs text-ink-2">{label}</div>
    </div>
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
  // A phone alert deep-links here as /?open=<okla>: open that elevator once the
  // list is available, then forget it so Back doesn't re-open it.
  const [openOkla, setOpenOkla] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("open") || "",
  );
  if (openOkla && roster.accounts) {
    const hit = roster.accounts.flatMap((a) => a.units).find((u) => u.okla === openOkla);
    if (hit) {
      setOpenOkla("");
      setSelected(hit);
      setStage("profile");
    }
  }

  const logout = () => signOut({ redirectUrl: "/sign-in" });

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
    screen = <NewElevator onBack={() => to("tabs")} onCreated={(e) => to("report", e)} />;
  } else if (stage === "profile" && live) {
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
    screen = <Report key={selected.okla} elevator={selected} onBack={() => to("profile")} />;
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
