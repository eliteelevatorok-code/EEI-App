import { readRange, writeCell } from "@/lib/google";

// Maintenance-info capture, keyed by the same per-row token used for the other
// public forms (column AH). The maintenance company reaches this from a link in
// the "Records needed" email and gives two facts about the elevator's last
// inspection — did it pass, and when — which feed this year's report.
const TAB = "Elevators";
const IDX = { okla: 0, building: 1, maintCo: 8, token: 33, lastResult: 38, lastInspected: 39 };

export type MaintElevator = {
  row: number;
  okla: string;
  building: string;
  maintCo: string;
  alreadyResult: string;
  alreadyDate: string;
};

// Find the elevator whose row carries this token. Returns null if unknown.
export async function findByToken(token: string): Promise<MaintElevator | null> {
  const t = token.trim();
  if (!t) return null;
  const rows = await readRange(`${TAB}!A2:AN`);
  const i = rows.findIndex((r) => (r[IDX.token] ?? "").trim() === t);
  if (i === -1) return null;
  const r = rows[i];
  return {
    row: 2 + i,
    okla: (r[IDX.okla] ?? "").trim(),
    building: (r[IDX.building] ?? "").trim(),
    maintCo: (r[IDX.maintCo] ?? "").trim(),
    alreadyResult: (r[IDX.lastResult] ?? "").trim(),
    alreadyDate: (r[IDX.lastInspected] ?? "").trim(),
  };
}

// Record the two answers: last result (Pass/Fail) in AM, last-inspected date in
// AN, and flip Maint. confirm (col W) to "Answered" so the lifecycle continues.
export async function recordMaint(row: number, result: string, date: string): Promise<void> {
  await writeCell(`${TAB}!AM${row}`, result);
  await writeCell(`${TAB}!AN${row}`, date);
  await writeCell(`${TAB}!W${row}`, "Answered");
}
