import { readRange, writeCell } from "@/lib/google";

// Customer PO capture, keyed by a random per-elevator token stored in column AH.
// The token in the link is the only thing that authorizes a submission — no login.
const TAB = "Elevators";
const IDX = { okla: 0, building: 1, account: 4, contact: 5, token: 33, poNumber: 34, poFile: 35 };

export type POElevator = {
  row: number;
  okla: string;
  building: string;
  account: string;
  alreadyPO: string; // an existing PO number on the row, if any
};

// Find the elevator whose row carries this token. Returns null if unknown.
export async function findByToken(token: string): Promise<POElevator | null> {
  const t = token.trim();
  if (!t) return null;
  const rows = await readRange(`${TAB}!A2:AJ`);
  const i = rows.findIndex((r) => (r[IDX.token] ?? "").trim() === t);
  if (i === -1) return null;
  const r = rows[i];
  return {
    row: 2 + i,
    okla: (r[IDX.okla] ?? "").trim(),
    building: (r[IDX.building] ?? "").trim(),
    account: (r[IDX.account] ?? "Unassigned").trim() || "Unassigned",
    alreadyPO: (r[IDX.poNumber] ?? "").trim(),
  };
}

// Record the PO number (col AI), an optional file link (col AJ), and flip the
// PO status cell (col U) to "Received" so the lifecycle and Next-action update.
export async function recordPO(row: number, poNumber: string, fileLink?: string): Promise<void> {
  await writeCell(`${TAB}!AI${row}`, poNumber);
  if (fileLink) await writeCell(`${TAB}!AJ${row}`, fileLink);
  await writeCell(`${TAB}!U${row}`, "Received");
}
