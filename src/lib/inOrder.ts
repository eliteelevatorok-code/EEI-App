// Robert (2026-10-16): "Nothing should ever move unless everything before it is
// done … every step is a trigger reacting from a previous trigger." The
// automation's routes check the same chain (archive/break-testing/in-order.js):
//   2-month heads-up Sent → (Invoice only, or quote Sent) → safety-test
//   question asked → scheduling email Sent → visit Booked
//   → inspection → report → invoice → payment.
// The customer's PO holds nothing up (Robert, 2026-10-26) — it's out of our
// hands. The inspection (and so the report) can only start once the visit is
// booked with every step before it done.

export type ChainValues = {
  moneyPath?: string;
  twoMoEmail: string;
  quote: string;
  po: string;
  maintConfirm: string;
  scheduling: string;
  visit: string;
  report: string;
};

// Why the inspection can't start yet — the first step that isn't done — or null
// if it can (visit booked in order, or inspected in order and the report not
// sent yet, so a report can be redone before it goes out).
export function inspectionBlocked(v: ChainValues): string | null {
  if (v.twoMoEmail !== "Sent") return "the 2-month heads-up email hasn't gone out";
  if (v.moneyPath !== "Invoice only") {
    if (v.quote !== "Sent") return "the price quote email hasn't gone out";
  }
  if (!v.maintConfirm) return "the safety test question hasn't gone out";
  if (v.scheduling !== "Sent") return "the scheduling email hasn't gone out";
  if (v.visit !== "Booked" && v.visit !== "Inspected") return "no visit is booked";
  if (v.report === "Sent") return "this visit's report has already been sent";
  return null;
}
