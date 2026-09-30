import { cell, findByToken, writeRow } from "@/lib/sheet";
import { toIsoDate } from "@/lib/records";

// The records form. The "Records needed" email (sent to American Elevator, or
// straight to the customer for any other maintenance company — see records.ts)
// links to /maint?t=<token>. They answer: a passing safety test in the last 12
// months (Yes/No), and its date. The date pre-fills the report's one-year test.

export type MaintElevator = {
  row: number;
  okla: string;
  building: string;
  maintCo: string;
  alreadyResult: string;
  alreadyDate: string;
};

export async function findForMaint(token: string): Promise<MaintElevator | null> {
  const hit = await findByToken(token);
  if (!hit) return null;
  const r = hit.cells;
  return {
    row: hit.row,
    okla: cell(r, "okla"),
    building: cell(r, "building"),
    maintCo: cell(r, "maintCo"),
    alreadyResult: cell(r, "safetyTest"),
    alreadyDate: cell(r, "safetyTestDate"),
  };
}

// Save the answers and mark Maint. confirm "Answered" so the lifecycle moves on.
// Used by the public form and by the app (entered by hand after a phone call).
// `result` is "Yes" / "No"; the date is only needed for "Yes". The date is saved
// the dashboard's way (M/D/YYYY), whichever way it arrived.
export async function recordMaint(row: number, result: string, date: string): Promise<void> {
  const iso = toIsoDate(date);
  const md = iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}/${iso.slice(0, 4)}` : "";
  await writeRow(row, { safetyTest: result, safetyTestDate: md, maintConfirm: "Answered" });
}
