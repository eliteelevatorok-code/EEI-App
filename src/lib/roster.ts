import { randomBytes } from "node:crypto";
import type { Account, Elevator, Field, LifecycleStage } from "@/lib/data";
import { appendRow } from "@/lib/google";
import { COL, FIRST_ROW, TAB, cell, letter, readRows, writeRow, type Col } from "@/lib/sheet";
import { safetyAnswer } from "@/lib/records";
import { TECH, type TechKey } from "@/lib/tech";
import { isRowPaused } from "@/lib/switches";

// Reading elevators off the dashboard for the phone app, and the few writes the
// app makes when an elevator is added or a report is finished.

// The customer lifecycle, left to right (dashboard columns S–AE). `options` are
// the choices Robert can pick by hand on the profile. `date`: picked with a date
// picker (saved M/D/YYYY). `locked`: shown, never changed by hand — the Report step
// is set only when the automation has emailed the finished report (Robert: the
// report is never edited directly), and Visit = Inspected only by finishing the
// report in the app, so it isn't a hand choice either.
const STAGES: { key: Col; label: string; options: string[]; date?: boolean; locked?: boolean }[] = [
  { key: "twoMoEmail", label: "2-month email", options: ["Sent"] },
  { key: "quote", label: "Quote", options: ["Review", "Sent"] },
  { key: "po", label: "PO", options: ["Awaiting", "Received", "N/A"] },
  { key: "scheduling", label: "Scheduling email", options: ["Sent"] },
  { key: "maintConfirm", label: "Safety test question", options: ["Waiting", "Answered", "No answer"] },
  { key: "accessReminder", label: "Access reminder", options: ["Sent"] },
  { key: "visit", label: "Visit", options: ["Booked"] },
  { key: "tripDay", label: "Trip day", options: [], date: true },
  { key: "report", label: "Report", options: [], locked: true },
  { key: "invoice", label: "Invoice", options: ["Sent"] },
  { key: "followUps", label: "Follow-ups", options: ["#1 sent", "#2 sent", "#3 sent"] },
  { key: "paid", label: "Paid", options: ["Paid"] },
  { key: "newTimer", label: "New timer set", options: ["Set"] },
];
// Same list with each stage's column letter, for writing a stage back (see /api/lifecycle).
export const LIFECYCLE_DEFS = STAGES.map((s) => ({ ...s, col: letter(COL[s.key]) }));

// The fixed details printed on the state form (serial, permit, owner, …), read
// from their own dashboard columns (AQ–BK, see src/lib/tech.ts).
const carriedFrom = (r: string[]): Field[] => TECH.map((t) => ({ label: t.label, value: cell(r, t.key) }));

// "9/12/2026" or "2026-09-12" → "09/2026" (the state form's test-date format).
function monthYear(s: string): string {
  const m = s.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/) ?? s.match(/^(\d{4})-(\d{1,2})-\d{1,2}$/);
  if (!m) return "";
  const [month, year] = s.includes("/") ? [m[1], m[2]] : [m[2], m[1]];
  return `${month.padStart(2, "0")}/${year}`;
}

// The dashboard's Cycle cell ("1 yr", "2", "Res" …) → "1" | "2" | "3" | "Res".
const parseCycle = (raw: string) => (/res/i.test(raw) ? "Res" : (raw.match(/\d+/)?.[0] ?? "1"));

function rowToElevator(r: string[], row: number): Elevator {
  return {
    okla: cell(r, "okla"),
    building: cell(r, "building"),
    account: cell(r, "account") || "Unassigned",
    contact: cell(r, "contact"),
    email: cell(r, "email"),
    phone: cell(r, "phone"),
    maintCo: cell(r, "maintCo"),
    maintContact: cell(r, "maintContact"),
    maintEmail: cell(r, "maintEmail"),
    maintPhone: cell(r, "maintPhone"),
    area: cell(r, "area"),
    city: cell(r, "city"),
    type: cell(r, "type"),
    floors: parseInt(cell(r, "floors"), 10) || 0,
    cycle: parseCycle(cell(r, "cycle")),
    due: cell(r, "due"),
    price: cell(r, "price"),
    moneyPath: cell(r, "moneyPath"),
    active: !isRowPaused(r),
    reportDone: !!cell(r, "reportFile"),
    row, // the sheet row, so later writes land on the right line
    lifecycle: LIFECYCLE_DEFS.map((d): LifecycleStage => ({
      key: d.key,
      label: d.label,
      col: d.col,
      value: cell(r, d.key),
      options: d.options,
      date: d.date,
      locked: d.locked,
    })),
    carried: carriedFrom(r),
    safetyTest: safetyAnswer(cell(r, "safetyTest")),
    safetyTestDate: cell(r, "safetyTestDate"),
    lastYear: {
      // From the records step (form, phone call, or entered by hand): a passing
      // safety test in the last 12 months and its date. The date pre-fills the
      // report's one-year test box (MM/YYYY). Blank until answered.
      date: cell(r, "safetyTestDate"),
      inspType: "Periodic",
      test1: safetyAnswer(cell(r, "safetyTest")) === "Yes" ? monthYear(cell(r, "safetyTestDate")) : "",
      test5: "",
      certIssue: safetyAnswer(cell(r, "safetyTest")) === "No" ? "No" : "Yes",
      condition: "No adverse conditions",
      notes: "",
    },
  };
}

// The whole roster, grouped by account for the elevator list.
export async function loadRoster(): Promise<Account[]> {
  const byAccount = new Map<string, Elevator[]>();
  (await readRows()).forEach((r, i) => {
    if (!cell(r, "okla")) return; // skip empty lines
    const e = rowToElevator(r, FIRST_ROW + i);
    byAccount.set(e.account, [...(byAccount.get(e.account) ?? []), e]);
  });
  return [...byAccount.entries()].map(([name, units]) => ({ name, units }));
}

// The sheet row for an OK #, or null if it isn't on the dashboard.
export async function findRowByOkla(okla: string): Promise<number | null> {
  const i = (await readRows()).findIndex((r) => cell(r, "okla") === okla.trim());
  return i === -1 ? null : FIRST_ROW + i;
}

// A brand-new elevator's dashboard fields (columns A–R, in order).
export type NewElevatorInput = {
  okla: string; building: string; area: string; city: string; account: string;
  contact: string; email: string; phone: string; maintCo: string; maintContact: string;
  maintEmail: string; maintPhone: string; type: string; floors: string; cycle: string;
  price: string; moneyPath: string; due: string;
} & Partial<Record<TechKey, string>>; // + the state-form details, if known

// Add a new elevator as a new row (A–R). Lifecycle cells start blank — the
// automation fills them over time. Also stamps a random link token so the
// customer's emailed links (PO form, pay page) work right away, and saves any
// state-form details given (so they're there for every future report).
export async function appendElevator(f: NewElevatorInput): Promise<number | null> {
  const row = await appendRow(`${TAB}!A:R`, [
    f.okla, f.building, f.area, f.city, f.account, f.contact, f.email, f.phone,
    f.maintCo, f.maintContact, f.maintEmail, f.maintPhone, f.type, f.floors, f.cycle,
    f.price, f.moneyPath, f.due,
  ]);
  if (row) {
    const extra: Partial<Record<Col, string>> = { token: randomBytes(16).toString("hex") };
    for (const t of TECH) if (f[t.key]) extra[t.key] = f[t.key];
    try {
      await writeRow(row, extra);
    } catch {
      // The row itself is saved; a failed extra write only means the link token /
      // details need adding afterwards — never fail the whole add-elevator over it.
    }
  }
  return row;
}

// Save the state-form details for one elevator (profile → "For the state form").
export async function setTechDetails(row: number, values: Partial<Record<TechKey, string>>): Promise<void> {
  await writeRow(row, values);
}

// A report was finished: Visit → Inspected, Trip day → the inspection date.
// Leave Report alone: the automation's "Report filed" step (route 6) waits for
// Visit = Inspected AND Report ≠ Sent, emails the report to the customer and
// ODOL, and only then sets Report = Sent — which is what starts billing.
export async function markInspected(row: number, dateText: string): Promise<void> {
  await writeRow(row, { visit: "Inspected", tripDay: dateText });
}

// Keep the finished report's Drive link on the row.
export async function setReportFile(row: number, link: string): Promise<void> {
  await writeRow(row, { reportFile: link });
}
