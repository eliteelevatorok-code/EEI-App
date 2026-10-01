import { randomBytes } from "node:crypto";
import { readRange, writeCells } from "@/lib/google";

// The dashboard's Elevators tab — the ONE place that knows which column holds
// what. Row 1 is the header row; elevators start on row 2. Everything else in the
// app reads and writes cells by NAME through the helpers below, so if a column
// ever moves, only the number here changes.
//
// Numbers are 0-based positions (A = 0, B = 1 … Z = 25, AA = 26 …), which is how
// a row comes back from the Sheets API. The Make automation also refers to
// columns by these same numbers (e.g. {{100.`29`}} = Paid).
export const TAB = "Elevators";
export const FIRST_ROW = 2;

export const COL = {
  // who and what (A–R), filled when an elevator is added
  okla: 0, building: 1, area: 2, city: 3, account: 4, contact: 5, email: 6, phone: 7,
  maintCo: 8, maintContact: 9, maintEmail: 10, maintPhone: 11, type: 12, floors: 13,
  cycle: 14, price: 15, moneyPath: 16, due: 17,
  // the customer lifecycle (S–AE), one status cell per stage
  twoMoEmail: 18, quote: 19, po: 20, scheduling: 21, maintConfirm: 22, accessReminder: 23,
  visit: 24, tripDay: 25, report: 26, invoice: 27, followUps: 28, paid: 29, newTimer: 30,
  // notes (AF) and the sheet's own "Next action" formula (AG) — the app doesn't write these
  notes: 31, nextAction: 32,
  // app/automation bookkeeping (AH–AP), then the state-form details (AQ–BK)
  token: 33, // random code in every emailed link (/po, /maint, /pay) — the only "login" those pages use
  poNumber: 34, poFile: 35, // from the customer's PO form
  invoiceId: 36, // QuickBooks invoice id
  active: 37, // on/off switch for this elevator ("Off" pauses it)
  safetyTest: 38, safetyTestDate: 39, // passing safety test in the last 12 months? Yes/No + its date (see records.ts)
  reportFile: 40, // Drive link to the latest finished report
  invoiceDate: 41, // day the invoice went out (AP) — the payment reminder waits 30 days from it
  // details for the state form (AQ–BK) — see src/lib/tech.ts
  serial: 42, permit: 43, manufacturer: 44, capacity: 45, speed: 46, rise: 47, openings: 48, landings: 49,
  deviceType: 50, machineType: 51, installedYear: 52, codeYear: 53, entityType: 54,
  owner: 55, ownerAddress: 56, ownerCity: 57, ownerState: 58, ownerZip: 59,
  locationAddress: 60, locationZip: 61, county: 62,
} as const;
export type Col = keyof typeof COL;

// 0 → "A", 25 → "Z", 26 → "AA", …
export function letter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const LAST = letter(COL.county); // read this far to get every column the app uses

// One trimmed cell from a row that was read from the sheet.
export const cell = (row: string[], c: Col) => (row[COL[c]] ?? "").trim();

// Every elevator row (A..BK). Array index i is sheet row FIRST_ROW + i.
export const readRows = () => readRange(`${TAB}!A${FIRST_ROW}:${LAST}`);

// One elevator row (A..BK), or [] if it's blank or past the end of the sheet.
export async function readRow(row: number): Promise<string[]> {
  if (!Number.isInteger(row) || row < FIRST_ROW) return [];
  try {
    return (await readRange(`${TAB}!A${row}:${LAST}${row}`))[0] ?? [];
  } catch (err) {
    // Google refuses rows beyond the sheet's size ("exceeds grid limits") — that's just "no elevator here".
    if (/grid limits/i.test(err instanceof Error ? err.message : "")) return [];
    throw err;
  }
}

// Before writing to a row: make sure it's the RIGHT elevator. The phone keeps a
// saved copy of the list (row numbers included); if someone inserts or deletes a
// row in the sheet, those numbers shift. So when the app says which elevator
// (`okla`), check that row still holds it — and if not, find where it moved.
// No elevator at all (blank line / past the end) → NoSuchRow, so nothing
// creates a half-filled "phantom" elevator. Returns the row to write to.
export async function requireElevatorRow(row: number, okla?: string): Promise<number> {
  const r = await readRow(row);
  const want = (okla ?? "").trim();
  if (want && cell(r, "okla") !== want) {
    const i = (await readRows()).findIndex((x) => cell(x, "okla") === want);
    if (i === -1) throw new NoSuchRow(`OK # ${want} isn't on the dashboard any more.`);
    return FIRST_ROW + i;
  }
  if (!cell(r, "okla")) throw new NoSuchRow(`There's no elevator on row ${row}.`);
  return row;
}
export class NoSuchRow extends Error {}

// Write any number of cells on one row in a single request, by column name.
export const writeRow = (row: number, values: Partial<Record<Col, string>>) =>
  writeCells(Object.entries(values).map(([c, v]) => [`${TAB}!${letter(COL[c as Col])}${row}`, v ?? ""]));

// Find the elevator whose link token matches. Used by the public pages opened
// from emails (/po, /maint, /pay, /api/report). Null if the token is unknown.
export async function findByToken(token: string): Promise<{ row: number; cells: string[] } | null> {
  const t = token.trim();
  if (!t) return null;
  const rows = await readRows();
  const i = rows.findIndex((r) => cell(r, "token") === t);
  return i === -1 ? null : { row: FIRST_ROW + i, cells: rows[i] };
}

// Every elevator needs a link token (the code inside every emailed link). The
// app's New elevator form makes one, but a row typed straight into the sheet has
// none — so any missing ones are filled here. Called at the start of every
// automation run (/api/switches/master); the automation's emails that carry a
// link also wait for the token, so a hand-typed elevator never gets a dead link.
// One caller only, so two runs can't hand the same row different tokens.
export async function fillMissingTokens(): Promise<number> {
  const rows = await readRows();
  const cells: [string, string][] = [];
  rows.forEach((r, i) => {
    if (cell(r, "okla") && !cell(r, "token")) cells.push([`${TAB}!${letter(COL.token)}${FIRST_ROW + i}`, randomBytes(16).toString("hex")]);
  });
  await writeCells(cells);
  return cells.length;
}
