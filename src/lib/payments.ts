import { appendRow, readRange } from "@/lib/google";
import { cell, readRow } from "@/lib/sheet";

// PAYMENTS LOG (Robert, 2026-10-15): the dashboard's "Payments" tab keeps every
// payment for good. An elevator's Invoice / Paid steps are cleared by the yearly
// reset the moment it's paid (next year's cycle starts), so the Money tab can't
// count money collected from those — it reads this log instead.
//
// The automation logs the payment right before the reset (Make route "New timer
// set" calls /api/payments/log?row=N first). One line per payment:
//   A Paid on (M/D/YYYY, Oklahoma) | B OK # | C Building | D Account | E Amount
//   F Invoice # | G Trip day | H Logged at (ISO)
// The same elevator + invoice (or, without an invoice #, the same trip day) is
// never logged twice.

export const PAYMENTS_TAB = "Payments";

export type Payment = { paidOn: string; okla: string; building: string; account: string; amount: number; invoice: string; tripDay: string };

const okDate = () => new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "numeric", day: "numeric", year: "numeric" });
const amountOf = (s: string) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;

export async function readPayments(): Promise<Payment[]> {
  const rows = await readRange(`${PAYMENTS_TAB}!A2:H`);
  return rows
    .filter((r) => r[1])
    .map((r) => ({ paidOn: r[0] ?? "", okla: r[1] ?? "", building: r[2] ?? "", account: r[3] ?? "", amount: amountOf(r[4] ?? ""), invoice: r[5] ?? "", tripDay: r[6] ?? "" }));
}

// Log row N's payment if it's marked Paid and not logged yet.
export async function logPayment(row: number): Promise<{ logged: boolean; skipped?: string }> {
  const r = await readRow(row);
  if (!cell(r, "okla")) return { logged: false, skipped: "no elevator on that row" };
  if (cell(r, "paid") !== "Paid") return { logged: false, skipped: "not paid" };
  const p: Payment = {
    paidOn: okDate(),
    okla: cell(r, "okla"),
    building: cell(r, "building"),
    account: cell(r, "account"),
    amount: amountOf(cell(r, "price")),
    invoice: cell(r, "invoiceId"),
    tripDay: cell(r, "tripDay"),
  };
  const seen = (await readPayments()).some((x) => x.okla === p.okla && (p.invoice ? x.invoice === p.invoice : x.tripDay === p.tripDay));
  if (seen) return { logged: false, skipped: "already logged" };
  await appendRow(`${PAYMENTS_TAB}!A:H`, [p.paidOn, p.okla, p.building, p.account, String(p.amount), p.invoice, p.tripDay, new Date().toISOString()]);
  return { logged: true };
}
