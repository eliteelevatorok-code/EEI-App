import { cell, readRow, writeRow } from "@/lib/sheet";
import { IS_SANDBOX, createInvoice, sendInvoice, getInvoiceBalance } from "@/lib/quickbooks";
import { isMasterOn, isRowPaused } from "@/lib/switches";

// The billing steps the Make automation triggers (via /api/invoice/run):
//
//   invoiceRow(row)   — report filed, not billed yet → create the QuickBooks
//                       invoice for the row's Price, store its id, and mark
//                       Invoice = "Sent" so payment reminders can start.
//   reconcileRow(row) — billed, not paid → ask QuickBooks for the balance; at 0
//                       mark Paid = "Paid" (the same box the /pay test button sets).
//
// Both refuse to act on a paused elevator or when the master switch is off.
// In production QuickBooks also emails its own official invoice; in the sandbox
// it can't, so testing relies on the /pay link in Make's invoice email instead.

// Turn "$1,175.50" or "175" into a number. Returns 0 if it can't be read.
function parsePrice(raw: string): number {
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Read one row, but only if the switches allow acting on it. Null = leave it alone.
async function activeRow(row: number): Promise<string[] | null> {
  const [masterOn, r] = await Promise.all([isMasterOn(), readRow(row)]);
  if (!masterOn || !cell(r, "okla") || isRowPaused(r)) return null;
  return r;
}

export type InvoiceResult =
  | { invoiced: true; row: number; building: string; invoiceId: string; amount: number; sent: boolean }
  | { invoiced: false; skipped: string };

// Bill one row. Checks the row itself (report filed, not already billed) so a
// repeated call can never create a second QuickBooks invoice.
export async function invoiceRow(row: number): Promise<InvoiceResult> {
  const r = await activeRow(row);
  if (!r) return { invoiced: false, skipped: "paused or empty row" };
  if (cell(r, "report") !== "Sent") return { invoiced: false, skipped: "report not filed yet" };
  // Check the status box, not the stored invoice id: the yearly reset clears the
  // status, and last year's invoice id may still be sitting in its column.
  if (cell(r, "invoice") === "Sent") return { invoiced: false, skipped: "already invoiced" };
  const email = cell(r, "email");
  const amount = parsePrice(cell(r, "price"));
  if (!email) return { invoiced: false, skipped: "no customer email on the row" };
  if (!(amount > 0)) return { invoiced: false, skipped: "no usable price on the row" };

  const building = cell(r, "building");
  const po = cell(r, "poNumber");
  const inv = await createInvoice({
    customerName: cell(r, "account") || "Unassigned",
    email,
    amount,
    memo: po ? `${building} — PO ${po}` : building,
  });
  if (!IS_SANDBOX) await sendInvoice(inv.Id, email); // production: QuickBooks emails the official bill

  // Save the id and the "Sent" status together (one write), so "Sent" never
  // exists without a way back to the invoice it refers to.
  await writeRow(row, { invoiceId: inv.Id, invoice: "Sent" });
  return { invoiced: true, row, building, invoiceId: inv.Id, amount, sent: !IS_SANDBOX };
}

// Mark one row Paid if its QuickBooks invoice balance has reached 0.
export async function reconcileRow(row: number): Promise<{ paid: boolean; skipped?: string }> {
  const r = await activeRow(row);
  if (!r) return { paid: false, skipped: "paused or empty row" };
  const id = cell(r, "invoiceId");
  if (!id) return { paid: false, skipped: "no invoice id" };
  if (cell(r, "paid") === "Paid") return { paid: false, skipped: "already paid" };
  const balance = await getInvoiceBalance(id);
  if (balance !== 0) return { paid: false, skipped: `balance ${balance}` };
  await writeRow(row, { paid: "Paid" });
  return { paid: true };
}
