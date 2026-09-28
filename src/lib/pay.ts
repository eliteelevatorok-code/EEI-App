import { cell, findByToken, writeRow } from "@/lib/sheet";

// The test "Pay now" button. The invoice email's link opens /pay?t=<token>;
// pressing the button sets Paid = "Paid" — the one signal the yearly cycle waits
// on. In production, QuickBooks' balance check (src/lib/invoice.ts) sets the same
// box the same way, so this button is a faithful stand-in for a real payment.

export type PayElevator = { row: number; building: string; price: string; alreadyPaid: boolean };

export async function findForPay(token: string): Promise<PayElevator | null> {
  const hit = await findByToken(token);
  if (!hit) return null;
  const r = hit.cells;
  return {
    row: hit.row,
    building: cell(r, "building"),
    price: cell(r, "price"),
    alreadyPaid: cell(r, "paid").toLowerCase() === "paid",
  };
}

export async function markPaid(row: number): Promise<void> {
  await writeRow(row, { paid: "Paid" });
}
