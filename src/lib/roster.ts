import type { Account, Elevator, Field, LifecycleStage } from "@/lib/data";
import { appendRow, readRange, writeCell } from "@/lib/google";

// Dashboard "Elevators" tab: data starts at row 3 (rows 1-2 are banner + headers).
const FIRST_DATA_ROW = 3;
const TAB = "Elevators";

// zero-based column indexes into a row
const C = {
  okla: 0, building: 1, area: 2, city: 3, account: 4, contact: 5, email: 6, phone: 7,
  maintCo: 8, maintContact: 9, maintEmail: 10, maintPhone: 11, type: 12, floors: 13,
  cycle: 14, price: 15, moneyPath: 16, due: 17,
  visit: 24, tripDay: 25, report: 26, // Y, Z, AA
};

// spreadsheet column letters for write-back
export const COL = { visit: "Y", tripDay: "Z", report: "AA" };

// The customer lifecycle, left-to-right (dashboard columns S..AE). `idx` is the
// zero-based row index; `col` the sheet letter (for write-back); `options` the
// cell's dropdown choices ([] = free text, e.g. the trip date).
export const LIFECYCLE_DEFS: { key: string; label: string; col: string; idx: number; options: string[] }[] = [
  { key: "twoMoEmail", label: "2-month email", col: "S", idx: 18, options: ["Sent"] },
  { key: "quote", label: "Quote", col: "T", idx: 19, options: ["Review", "Sent"] },
  { key: "po", label: "PO", col: "U", idx: 20, options: ["Awaiting", "Received", "N/A"] },
  { key: "scheduling", label: "Scheduling email", col: "V", idx: 21, options: ["Sent"] },
  { key: "maintConfirm", label: "Maint. confirm", col: "W", idx: 22, options: ["Waiting", "Answered", "No answer"] },
  { key: "accessReminder", label: "Access reminder", col: "X", idx: 23, options: ["Sent"] },
  { key: "visit", label: "Visit", col: "Y", idx: 24, options: ["Booked", "Inspected"] },
  { key: "tripDay", label: "Trip day", col: "Z", idx: 25, options: [] },
  { key: "report", label: "Report", col: "AA", idx: 26, options: ["Sent"] },
  { key: "invoice", label: "Invoice", col: "AB", idx: 27, options: ["Sent"] },
  { key: "followUps", label: "Follow-ups", col: "AC", idx: 28, options: ["#1 sent", "#2 sent", "#3 sent"] },
  { key: "paid", label: "Paid", col: "AD", idx: 29, options: ["Paid"] },
  { key: "newTimer", label: "New timer set", col: "AE", idx: 30, options: ["Set"] },
];

// The carried (locked) technical fields the report needs. The roster does not
// hold these yet — they come from last year's saved report — so they start blank.
const CARRIED_LABELS = [
  "Serial number", "Permit #", "Manufacturer", "Capacity (lbs)", "Speed (FPM)",
  "Rise", "Openings", "# of landings", "Device type", "Installed year",
  "Code year", "Machine type", "Owner", "Owner address", "Location address",
];
const blankCarried = (): Field[] => CARRIED_LABELS.map((label) => ({ label, value: "" }));

const cell = (row: string[], i: number) => (row[i] ?? "").trim();
const parseCycle = (raw: string) => {
  if (/res/i.test(raw)) return "Res";
  const m = raw.match(/\d+/);
  return m ? m[0] : "1";
};

function rowToElevator(row: string[], rowNumber: number): Elevator {
  return {
    okla: cell(row, C.okla),
    building: cell(row, C.building),
    account: cell(row, C.account) || "Unassigned",
    contact: cell(row, C.contact),
    area: cell(row, C.area),
    city: cell(row, C.city),
    type: cell(row, C.type),
    floors: parseInt(cell(row, C.floors), 10) || 0,
    cycle: parseCycle(cell(row, C.cycle)),
    due: cell(row, C.due),
    row: rowNumber, // the sheet row, so finalize writes back to the right line
    lifecycle: LIFECYCLE_DEFS.map((d): LifecycleStage => ({
      key: d.key,
      label: d.label,
      col: d.col,
      value: cell(row, d.idx),
      options: d.options,
    })),
    carried: blankCarried(),
    lastYear: { date: "", inspType: "Periodic", test1: "", test5: "", certIssue: "Yes", condition: "No adverse conditions", notes: "" },
  };
}

// Read the whole roster and group it by account for the picker.
export async function loadRoster(): Promise<Account[]> {
  const rows = await readRange(`${TAB}!A${FIRST_DATA_ROW}:AF`);
  const byAccount = new Map<string, Elevator[]>();
  rows.forEach((row, i) => {
    if (!cell(row, C.okla)) return; // skip empty lines
    const e = rowToElevator(row, FIRST_DATA_ROW + i);
    const list = byAccount.get(e.account) ?? [];
    list.push(e);
    byAccount.set(e.account, list);
  });
  return [...byAccount.entries()].map(([name, units]) => ({ name, units }));
}

// Find the sheet row for an OK #, so finalize writes to the correct line.
export async function findRowByOkla(okla: string): Promise<number | null> {
  const rows = await readRange(`${TAB}!A${FIRST_DATA_ROW}:A`);
  const idx = rows.findIndex((r) => (r[0] ?? "").trim() === okla.trim());
  return idx === -1 ? null : FIRST_DATA_ROW + idx;
}

// A brand-new elevator's roster fields (dashboard columns A..R, in order).
export type NewElevatorInput = {
  okla: string; building: string; area: string; city: string; account: string;
  contact: string; email: string; phone: string; maintCo: string; maintContact: string;
  maintEmail: string; maintPhone: string; type: string; floors: string; cycle: string;
  price: string; moneyPath: string; due: string;
};

// Append a new elevator as a new row on the dashboard (cols A..R). Lifecycle
// cells (S..AE) are left blank — the engine/app fills them over time.
export async function appendElevator(f: NewElevatorInput): Promise<number | null> {
  const row = [
    f.okla, f.building, f.area, f.city, f.account, f.contact, f.email, f.phone,
    f.maintCo, f.maintContact, f.maintEmail, f.maintPhone, f.type, f.floors, f.cycle,
    f.price, f.moneyPath, f.due,
  ];
  return appendRow(`${TAB}!A:R`, row);
}

// Flip the lifecycle cells when a report is finalized.
export async function markInspected(rowNumber: number, dateText: string): Promise<void> {
  await writeCell(`${TAB}!${COL.visit}${rowNumber}`, "Inspected");
  await writeCell(`${TAB}!${COL.tripDay}${rowNumber}`, dateText);
  await writeCell(`${TAB}!${COL.report}${rowNumber}`, "Sent");
}
