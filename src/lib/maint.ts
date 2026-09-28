import { cell, findByToken, writeRow } from "@/lib/sheet";

// Maintenance-company form. The "Records needed" email's link opens
// /maint?t=<token>. They answer two things about the elevator's LAST inspection —
// did it pass, and when — which carry into this year's report (see roster.ts).

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
    alreadyResult: cell(r, "lastResult"),
    alreadyDate: cell(r, "lastInspected"),
  };
}

// Save the answers and mark Maint. confirm "Answered" so the lifecycle moves on.
export async function recordMaint(row: number, result: string, date: string): Promise<void> {
  await writeRow(row, { lastResult: result, lastInspected: date, maintConfirm: "Answered" });
}
