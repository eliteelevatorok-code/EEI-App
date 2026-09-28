import { readRange, writeCell } from "@/lib/google";
import { createInvoice, sendInvoice, getInvoiceBalance } from "@/lib/quickbooks";
import { isMasterOn, isRowPaused } from "@/lib/switches";

// The billing steps the Make automation triggers (via /api/invoice/run):
//
//   invoiceRow(row)   — report filed, not billed yet → create the QuickBooks
//                       invoice for the row's Price, store its id (col AK), and
//                       mark Invoice = "Sent" so payment reminders can start.
//   reconcileRow(row) — billed, not paid → ask QuickBooks for the balance; at 0
//                       mark Paid = "Paid" (the same box the /pay test button sets).
//
// Both refuse to act on a paused elevator or when the master switch is off.
// In production QuickBooks also emails its own official invoice; in the sandbox
// it can't, so testing relies on the /pay link in Make's invoice email instead.

const TAB = "Elevators";
const IS_SANDBOX = (process.env.QB_BASE ?? "https://sandbox-quickbooks.api.intuit.com").includes("sandbox");

// zero-based column positions on the Elevators tab
const IDX = {
  okla: 0, building: 1, account: 4, email: 6, price: 15,
  report: 26, // AA
  invoice: 27, // AB
  paid: 29, // AD
  poNumber: 34, // AI
  invoiceId: 36, // AK — QuickBooks invoice id
};
const COL = { invoice: "AB", paid: "AD", invoiceId: "AK" }; // letters, for writing back

const cell = (r: string[], i: number) => (r[i] ?? "").trim();

// Turn "$1,175.50" or "175" into a number. Returns 0 if it can't be read.
function parsePrice(raw: string): number {
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Read one row, but only if the switches allow acting on it. Null = leave it alone.
async function activeRow(row: number): Promise<string[] | null> {
  const [masterOn, rows] = await Promise.all([isMasterOn(), readRange(`${TAB}!A${row}:AL${row}`)]);
  const r = rows[0];
  if (!masterOn || !r || !cell(r, IDX.okla) || isRowPaused(r)) return null;
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
  if (cell(r, IDX.report) !== "Sent") return { invoiced: false, skipped: "report not filed yet" };
  // Check the status box, not the stored invoice id: the yearly reset clears the
  // status, and the id from last year's invoice may still be sitting in col AK.
  if (cell(r, IDX.invoice) === "Sent") return { invoiced: false, skipped: "already invoiced" };
  const email = cell(r, IDX.email);
  const amount = parsePrice(cell(r, IDX.price));
  if (!email) return { invoiced: false, skipped: "no customer email on the row" };
  if (!(amount > 0)) return { invoiced: false, skipped: "no usable price on the row" };

  const building = cell(r, IDX.building);
  const po = cell(r, IDX.poNumber);
  const inv = await createInvoice({
    customerName: cell(r, IDX.account) || "Unassigned",
    email,
    amount,
    memo: po ? `${building} — PO ${po}` : building,
  });
  if (!IS_SANDBOX) await sendInvoice(inv.Id, email); // production: QuickBooks emails the official bill

  // Store the invoice id before marking "Sent", so "Sent" never exists without
  // a way back to the invoice it refers to.
  await writeCell(`${TAB}!${COL.invoiceId}${row}`, inv.Id);
  await writeCell(`${TAB}!${COL.invoice}${row}`, "Sent");
  return { invoiced: true, row, building, invoiceId: inv.Id, amount, sent: !IS_SANDBOX };
}

// Mark one row Paid if its QuickBooks invoice balance has reached 0.
export async function reconcileRow(row: number): Promise<{ paid: boolean; skipped?: string }> {
  const r = await activeRow(row);
  if (!r) return { paid: false, skipped: "paused or empty row" };
  const id = cell(r, IDX.invoiceId);
  if (!id) return { paid: false, skipped: "no invoice id" };
  if (cell(r, IDX.paid) === "Paid") return { paid: false, skipped: "already paid" };
  const balance = await getInvoiceBalance(id);
  if (balance !== 0) return { paid: false, skipped: `balance ${balance}` };
  await writeCell(`${TAB}!${COL.paid}${row}`, "Paid");
  return { paid: true };
}
