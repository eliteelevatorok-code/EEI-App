import { randomBytes } from "node:crypto";
import type { Account, Elevator, Field, LifecycleStage } from "@/lib/data";
import { appendRow } from "@/lib/google";
import { COL, FIRST_ROW, TAB, cell, letter, readRows, writeRow, type Col } from "@/lib/sheet";
import { isRowPaused } from "@/lib/switches";

// Reading elevators off the dashboard for the phone app, and the few writes the
// app makes when an elevator is added or a report is finished.

// The customer lifecycle, left to right (dashboard columns S–AE). `options` are
// the cell's dropdown choices ([] = free text, e.g. the trip date).
const STAGES: { key: Col; label: string; options: string[] }[] = [
  { key: "twoMoEmail", label: "2-month email", options: ["Sent"] },
  { key: "quote", label: "Quote", options: ["Review", "Sent"] },
  { key: "po", label: "PO", options: ["Awaiting", "Received", "N/A"] },
  { key: "scheduling", label: "Scheduling email", options: ["Sent"] },
  { key: "maintConfirm", label: "Maint. confirm", options: ["Waiting", "Answered", "No answer"] },
  { key: "accessReminder", label: "Access reminder", options: ["Sent"] },
  { key: "visit", label: "Visit", options: ["Booked", "Inspected"] },
  { key: "tripDay", label: "Trip day", options: [] },
  { key: "report", label: "Report", options: ["Sent"] },
  { key: "invoice", label: "Invoice", options: ["Sent"] },
  { key: "followUps", label: "Follow-ups", options: ["#1 sent", "#2 sent", "#3 sent"] },
  { key: "paid", label: "Paid", options: ["Paid"] },
  { key: "newTimer", label: "New timer set", options: ["Set"] },
];
// Same list with each stage's column letter, for writing a stage back (see /api/lifecycle).
export const LIFECYCLE_DEFS = STAGES.map((s) => ({ ...s, col: letter(COL[s.key]) }));

// The fixed technical details printed on the report (serial, permit, …). The
// dashboard doesn't store these yet, so they start blank for existing elevators;
// a brand-new elevator gets them from the "New elevator" form for its first report.
const CARRIED_LABELS = [
  "Serial number", "Permit #", "Manufacturer", "Capacity (lbs)", "Speed (FPM)",
  "Rise", "Openings", "# of landings", "Device type", "Installed year",
  "Code year", "Machine type", "Owner", "Owner address", "Location address",
];
const blankCarried = (): Field[] => CARRIED_LABELS.map((label) => ({ label, value: "" }));

// The dashboard's Cycle cell ("1 yr", "2", "Res" …) → "1" | "2" | "3" | "Res".
const parseCycle = (raw: string) => (/res/i.test(raw) ? "Res" : (raw.match(/\d+/)?.[0] ?? "1"));

function rowToElevator(r: string[], row: number): Elevator {
  return {
    okla: cell(r, "okla"),
    building: cell(r, "building"),
    account: cell(r, "account") || "Unassigned",
    contact: cell(r, "contact"),
    email: cell(r, "email"),
    area: cell(r, "area"),
    city: cell(r, "city"),
    type: cell(r, "type"),
    floors: parseInt(cell(r, "floors"), 10) || 0,
    cycle: parseCycle(cell(r, "cycle")),
    due: cell(r, "due"),
    price: cell(r, "price"),
    moneyPath: cell(r, "moneyPath"),
    active: !isRowPaused(r),
    row, // the sheet row, so later writes land on the right line
    lifecycle: LIFECYCLE_DEFS.map((d): LifecycleStage => ({
      key: d.key,
      label: d.label,
      col: d.col,
      value: cell(r, d.key),
      options: d.options,
    })),
    carried: blankCarried(),
    lastYear: {
      // From the maintenance company's /maint form: did it pass last time, and
      // when. Blank until they answer.
      date: cell(r, "lastInspected"),
      inspType: "Periodic",
      test1: "",
      test5: "",
      certIssue: cell(r, "lastResult") === "Fail" ? "No" : "Yes",
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
};

// Add a new elevator as a new row (A–R). Lifecycle cells start blank — the
// automation fills them over time. Also stamps a random link token so the
// customer's emailed links (PO form, pay page) work right away.
export async function appendElevator(f: NewElevatorInput): Promise<number | null> {
  const row = await appendRow(`${TAB}!A:R`, [
    f.okla, f.building, f.area, f.city, f.account, f.contact, f.email, f.phone,
    f.maintCo, f.maintContact, f.maintEmail, f.maintPhone, f.type, f.floors, f.cycle,
    f.price, f.moneyPath, f.due,
  ]);
  if (row) {
    try {
      await writeRow(row, { token: randomBytes(16).toString("hex") });
    } catch {
      // A missing token only means the emailed links need one added later —
      // never fail the whole add-elevator over it.
    }
  }
  return row;
}

// A report was finished: Visit → Inspected, Trip day → the inspection date,
// Report → Sent (which lets the automation send the report and then bill).
export async function markInspected(row: number, dateText: string): Promise<void> {
  await writeRow(row, { visit: "Inspected", tripDay: dateText, report: "Sent" });
}

// Keep the finished report's Drive link on the row.
export async function setReportFile(row: number, link: string): Promise<void> {
  await writeRow(row, { reportFile: link });
}
