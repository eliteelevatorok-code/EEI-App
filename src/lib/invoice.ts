import { readRange, writeCell } from "@/lib/google";
import { createInvoice, sendInvoice, getInvoiceBalance, type Invoice } from "@/lib/quickbooks";
import { guards } from "@/lib/switches";

// The invoice step. When an inspection report has been filed (Report AA = "Sent")
// and no invoice has gone out yet (Invoice AB ≠ "Sent"), this creates the bill in
// QuickBooks for the row's Price, stores the QuickBooks invoice id on the row, and
// marks Invoice = "Sent" so the payment reminders can begin.
//
// In production QuickBooks sends its own official email (PDF + pay-online). In the
// sandbox that email is not delivered, so testing leans on the /pay link instead
// (the same per-row token used for PO capture, already on the row in column AH).

const TAB = "Elevators";
const IS_SANDBOX = (process.env.QB_BASE ?? "https://sandbox-quickbooks.api.intuit.com").includes("sandbox");

// zero-based column indexes
const IDX = {
  okla: 0, building: 1, account: 4, email: 6, price: 15,
  report: 26, // AA
  invoice: 27, // AB
  paid: 29, // AD
  poNumber: 34, // AI
  invoiceId: 36, // AK — QuickBooks invoice id (new)
};
// write-back column letters
const COL = { invoice: "AB", paid: "AD", invoiceId: "AK" };

export type Invoiceable = {
  row: number;
  okla: string;
  building: string;
  account: string;
  email: string;
  amount: number;
  poNumber: string;
};

// Turn "$1,175.50" or "175" into a number. Returns 0 if it can't be read.
function parsePrice(raw: string): number {
  const n = Number((raw ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const cell = (r: string[], i: number) => (r[i] ?? "").trim();

// Read the roster and return every row that is ready to be invoiced but hasn't
// been yet. Skips rows missing an email or a usable price (those need a human).
export async function findInvoiceable(): Promise<{ ready: Invoiceable[]; skipped: { building: string; why: string }[] }> {
  const { masterOn, offRows } = await guards();
  if (!masterOn) return { ready: [], skipped: [{ building: "—", why: "the master switch is OFF — everything is paused" }] };
  const rows = await readRange(`${TAB}!A2:AK`);
  const ready: Invoiceable[] = [];
  const skipped: { building: string; why: string }[] = [];
  rows.forEach((r, i) => {
    if (!cell(r, IDX.okla)) return;
    if (offRows.has(2 + i)) return; // this elevator is switched off
    if (cell(r, IDX.report) !== "Sent") return; // report not filed yet
    if (cell(r, IDX.invoice) === "Sent") return; // already invoiced
    const building = cell(r, IDX.building);
    const email = cell(r, IDX.email);
    const amount = parsePrice(cell(r, IDX.price));
    if (!email) return skipped.push({ building, why: "no customer email on the row" }), undefined;
    if (!(amount > 0)) return skipped.push({ building, why: "no usable price on the row" }), undefined;
    ready.push({
      row: 2 + i,
      okla: cell(r, IDX.okla),
      building,
      account: cell(r, IDX.account) || "Unassigned",
      email,
      amount,
      poNumber: cell(r, IDX.poNumber),
    });
  });
  return { ready, skipped };
}

// Read one row's invoice fields directly (for invoicing a single named row).
export async function findInvoiceableRow(row: number): Promise<Invoiceable | null> {
  const { masterOn, offRows } = await guards();
  if (!masterOn || offRows.has(row)) return null; // paused — treat as not invoiceable
  const rows = await readRange(`${TAB}!A${row}:AK${row}`);
  const r = rows[0];
  if (!r || !cell(r, IDX.okla)) return null;
  const amount = parsePrice(cell(r, IDX.price));
  const email = cell(r, IDX.email);
  if (!email || !(amount > 0)) return null;
  return {
    row,
    okla: cell(r, IDX.okla),
    building: cell(r, IDX.building),
    account: cell(r, IDX.account) || "Unassigned",
    email,
    amount,
    poNumber: cell(r, IDX.poNumber),
  };
}

export type InvoiceResult = { row: number; building: string; invoiceId: string; amount: number; sent: boolean };

// Invoice one row: create the QuickBooks invoice, (production) send the official
// email, store the invoice id on the row, and mark Invoice = "Sent".
export async function invoiceOne(el: Invoiceable): Promise<InvoiceResult> {
  const memo = el.poNumber ? `${el.building} — PO ${el.poNumber}` : el.building;
  const inv: Invoice = await createInvoice({
    customerName: el.account,
    email: el.email,
    amount: el.amount,
    memo,
  });
  let sent = false;
  if (!IS_SANDBOX) {
    // Production only: QuickBooks emails its own official bill to the customer.
    await sendInvoice(inv.Id, el.email);
    sent = true;
  }
  // Store the invoice id first, so the "Sent" mark is never set without a way
  // back to the invoice it refers to.
  await writeCell(`${TAB}!${COL.invoiceId}${el.row}`, inv.Id);
  await writeCell(`${TAB}!${COL.invoice}${el.row}`, "Sent");
  return { row: el.row, building: el.building, invoiceId: inv.Id, amount: el.amount, sent };
}

export type PaidResult = { row: number; building: string; invoiceId: string };

// The paid signal, read from QuickBooks. For every row that carries a QuickBooks
// invoice id and is not yet marked Paid, read that invoice's balance; a balance
// of 0 means the customer has paid, so set Paid = "Paid" — the same box the /pay
// test button flips, so the lifecycle continues identically either way.
export async function reconcilePaid(): Promise<{
  updated: PaidResult[];
  checked: number;
  errors: { row: number; building: string; why: string }[];
}> {
  const { masterOn, offRows } = await guards();
  if (!masterOn) return { updated: [], checked: 0, errors: [] };
  const rows = await readRange(`${TAB}!A2:AK`);
  const updated: PaidResult[] = [];
  const errors: { row: number; building: string; why: string }[] = [];
  let checked = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!cell(r, IDX.okla)) continue;
    if (offRows.has(2 + i)) continue; // this elevator is switched off
    const id = cell(r, IDX.invoiceId);
    if (!id) continue; // no QuickBooks invoice on this row
    if (cell(r, IDX.paid) === "Paid") continue; // already settled
    checked++;
    const rowNum = 2 + i;
    const building = cell(r, IDX.building);
    try {
      const balance = await getInvoiceBalance(id);
      if (balance === 0) {
        await writeCell(`${TAB}!${COL.paid}${rowNum}`, "Paid");
        updated.push({ row: rowNum, building, invoiceId: id });
      }
    } catch (err) {
      // A single unreadable invoice (deleted, voided) must not stop the rest.
      errors.push({ row: rowNum, building, why: err instanceof Error ? err.message : "read failed" });
    }
  }
  return { updated, checked, errors };
}
