import { readRange, writeCell } from "@/lib/google";

// The "pay" button, keyed by the same per-row token used for PO capture (col AH).
// Clicking it flips the Paid box (col AD) to "Paid" — the one signal the lifecycle
// waits on before the cycle continues. In production the QuickBooks balance-reader
// writes the same box the same way, so this button is a faithful stand-in.
const TAB = "Elevators";
const IDX = { building: 1, price: 15, token: 33, paid: 29 };

export type PayElevator = {
  row: number;
  building: string;
  price: string;
  alreadyPaid: boolean;
};

// Find the row carrying this token. Returns null if the token is unknown.
export async function findForPay(token: string): Promise<PayElevator | null> {
  const t = token.trim();
  if (!t) return null;
  const rows = await readRange(`${TAB}!A2:AJ`);
  const i = rows.findIndex((r) => (r[IDX.token] ?? "").trim() === t);
  if (i === -1) return null;
  const r = rows[i];
  return {
    row: 2 + i,
    building: (r[IDX.building] ?? "").trim(),
    price: (r[IDX.price] ?? "").trim(),
    alreadyPaid: (r[IDX.paid] ?? "").trim().toLowerCase() === "paid",
  };
}

// Mark the row paid: set the Paid box (col AD) to "Paid".
export async function markPaid(row: number): Promise<void> {
  await writeCell(`${TAB}!AD${row}`, "Paid");
}
