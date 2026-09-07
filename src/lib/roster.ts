import type { Account, Elevator, Field } from "@/lib/data";
import { readRange, writeCell } from "@/lib/google";

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

// Flip the lifecycle cells when a report is finalized.
export async function markInspected(rowNumber: number, dateText: string): Promise<void> {
  await writeCell(`${TAB}!${COL.visit}${rowNumber}`, "Inspected");
  await writeCell(`${TAB}!${COL.tripDay}${rowNumber}`, dateText);
  await writeCell(`${TAB}!${COL.report}${rowNumber}`, "Sent");
}
