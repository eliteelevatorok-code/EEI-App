import { cell, readRow, writeRow } from "@/lib/sheet";
import { createInvoice, getInvoiceBalance, isSandbox, sendInvoice } from "@/lib/quickbooks";
import { isMasterOn, isRowPaused } from "@/lib/switches";
import { sendProblemAlert } from "@/lib/push";

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

// Read one row, but only if the switches allow acting on it. Otherwise say why
// (the real reason — master switch, this elevator paused, or no elevator there).
async function activeRow(row: number): Promise<{ r: string[] } | { skip: string }> {
  const [masterOn, r] = await Promise.all([isMasterOn(), readRow(row)]);
  if (!masterOn) return { skip: "master switch is off" };
  if (!cell(r, "okla")) return { skip: "no elevator on that row" };
  if (isRowPaused(r)) return { skip: "this elevator is paused" };
  return { r };
}

export type InvoiceResult =
  | { invoiced: true; row: number; building: string; invoiceId: string; amount: number; sent: boolean }
  | { invoiced: false; skipped: string };

// Bill one row. Checks the row itself (report filed, not already billed) so a
// repeated call can never create a second QuickBooks invoice.
export async function invoiceRow(row: number): Promise<InvoiceResult> {
  const a = await activeRow(row);
  if ("skip" in a) return { invoiced: false, skipped: a.skip };
  const { r } = a;
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
  // Save the id, the "Sent" status and today's date together (one write), so
  // "Sent" never exists without a way back to the invoice it refers to. The date
  // is what the payment reminder counts 30 days from (Make route 7). Saved BEFORE
  // QuickBooks emails it: if that email fails, the next run must not create a
  // second real invoice.
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago" }); // e.g. 9/29/2026
  await writeRow(row, { invoiceId: inv.Id, invoice: "Sent", invoiceDate: today });

  // Real company: QuickBooks emails the official bill. `sent` tells the
  // automation to skip its own invoice email (Make route 9, #103), so the
  // customer gets one bill, not two. If QuickBooks' email fails, ours goes
  // instead and Robert's phone is told.
  let sent = false;
  if (!(await isSandbox())) {
    try {
      await sendInvoice(inv.Id, email);
      sent = true;
    } catch (e) {
      const why = e instanceof Error ? e.message : "failed";
      await sendProblemAlert(cell(r, "okla"), building, "QuickBooks invoice email", why).catch(() => {});
    }
  }
  return { invoiced: true, row, building, invoiceId: inv.Id, amount, sent };
}

// Mark one row Paid if its QuickBooks invoice balance has reached 0.
export async function reconcileRow(row: number): Promise<{ paid: boolean; skipped?: string }> {
  const a = await activeRow(row);
  if ("skip" in a) return { paid: false, skipped: a.skip };
  const { r } = a;
  const id = cell(r, "invoiceId");
  if (!id) return { paid: false, skipped: "no invoice id" };
  if (cell(r, "paid") === "Paid") return { paid: false, skipped: "already paid" };
  const balance = await getInvoiceBalance(id);
  if (balance !== 0) return { paid: false, skipped: `balance ${balance}` };
  await writeRow(row, { paid: "Paid" });
  return { paid: true };
}
