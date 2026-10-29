import { appendRow, ensureTab, readRange, writeCells } from "@/lib/google";
import { getInvoiceBalance } from "@/lib/quickbooks";
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

// Log row N's payment if it's marked Paid and not logged yet — or, if its bill
// is out but unpaid, carry the bill over to the Unpaid bills tab (below).
export async function logPayment(row: number): Promise<{ logged: boolean; carried?: boolean; skipped?: string }> {
  const r = await readRow(row);
  if (!cell(r, "okla")) return { logged: false, skipped: "no elevator on that row" };
  if (cell(r, "paid") !== "Paid") {
    if (cell(r, "invoice") !== "Sent") return { logged: false, skipped: "not paid" };
    return { logged: false, carried: await carryOver(r) };
  }
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

// UNPAID BILLS (Robert, 2026-10-29: next year starts on time even if the bill
// isn't paid). When the next due date comes near and the bill is still unpaid,
// the automation restarts the elevator's cycle anyway — which clears its
// Invoice / Paid steps — so the bill moves here first (same Make step that logs
// payments). The app keeps asking QuickBooks about it every hour; once it's
// paid, it's stamped here and logged on the Payments tab. Until then it shows on
// the Money tab and in the phone alerts.
//   A Billed on | B OK # | C Building | D Account | E Amount | F Invoice #
//   G Trip day | H Carried over at (ISO) | I Paid on (blank until paid)
export const UNPAID_TAB = "Unpaid bills";
const UNPAID_HEADER = ["Billed on", "OK #", "Building", "Account", "Amount", "Invoice #", "Trip day", "Carried over at", "Paid on"];
export type UnpaidBill = { billedOn: string; okla: string; building: string; account: string; amount: number; invoice: string; tripDay: string; paidOn: string; line: number };

export async function readUnpaid(): Promise<UnpaidBill[]> {
  await ensureTab(UNPAID_TAB, UNPAID_HEADER);
  const rows = await readRange(`'${UNPAID_TAB}'!A2:I`);
  return rows
    .map((r, i) => ({
      billedOn: r[0] ?? "", okla: r[1] ?? "", building: r[2] ?? "", account: r[3] ?? "", amount: amountOf(r[4] ?? ""),
      invoice: r[5] ?? "", tripDay: r[6] ?? "", paidOn: r[8] ?? "", line: i + 2,
    }))
    .filter((b) => b.okla);
}

async function carryOver(r: string[]): Promise<boolean> {
  const b = { okla: cell(r, "okla"), invoice: cell(r, "invoiceId"), tripDay: cell(r, "tripDay") };
  const seen = (await readUnpaid()).some((x) => x.okla === b.okla && (b.invoice ? x.invoice === b.invoice : x.tripDay === b.tripDay));
  if (!seen) {
    await appendRow(`'${UNPAID_TAB}'!A:I`, [
      cell(r, "invoiceDate"), b.okla, cell(r, "building"), cell(r, "account"), String(amountOf(cell(r, "price"))), b.invoice, b.tripDay, new Date().toISOString(), "",
    ]);
  }
  return true;
}

// Ask QuickBooks about every carried-over bill still unpaid; a balance of 0
// marks it paid here and logs it on the Payments tab. Returns how many got paid.
export async function reconcileUnpaid(): Promise<number> {
  let paid = 0;
  for (const b of await readUnpaid()) {
    if (b.paidOn || !b.invoice) continue;
    if ((await getInvoiceBalance(b.invoice)) !== 0) continue;
    const on = okDate();
    await writeCells([[`'${UNPAID_TAB}'!I${b.line}`, on]]);
    const seen = (await readPayments()).some((x) => x.okla === b.okla && x.invoice === b.invoice);
    if (!seen) await appendRow(`${PAYMENTS_TAB}!A:H`, [on, b.okla, b.building, b.account, String(b.amount), b.invoice, b.tripDay, new Date().toISOString()]);
    paid++;
  }
  return paid;
}
