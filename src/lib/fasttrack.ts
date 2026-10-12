// FAST TRACK, one step at a time. On an elevator's page, "Access fast track"
// shows its NEXT automatic pre-visit step; Robert picks a date and time (at
// least an hour out) and confirms. The app saves the step (col BM) and the time
// (col BN, ISO UTC). At the first hourly automation run after that time, that
// step goes out regardless of its usual due-date window, and the automation
// clears BM/BN — so the elevator is back on normal timing until the next step is
// fast-tracked (see archive/break-testing/fast-track-steps.js for the Make side).
//
// Pure (no server code) so the phone and the server agree on the next step.

export type FastStepKey = "heads-up" | "quote" | "safety" | "scheduling" | "access";

export const FAST_STEPS: Record<FastStepKey, { label: string; what: string }> = {
  "heads-up": { label: "2-month heads-up email", what: "the 2-month heads-up email to the customer" },
  quote: { label: "Quote email", what: "the quote email (with the PO link) to the customer" },
  safety: { label: "Safety-test question", what: "the safety-test question (to American Elevator if they maintain it, otherwise the customer)" },
  scheduling: { label: "Scheduling email", what: "the scheduling email (with the booking link) to the customer" },
  access: { label: "Access reminder", what: "the access reminder for the booked visit to the customer" },
};

// The elevator's values by column name (from the dashboard row or the app's copy).
export type FastInputs = {
  email: string;
  price: string;
  moneyPath: string;
  twoMoEmail: string;
  quote: string;
  maintConfirm: string;
  scheduling: string;
  accessReminder: string;
  visit: string;
  tripDay: string;
};

// The next step that can be fast-tracked — or why there isn't one. Same order
// the automation follows; steps that don't apply are skipped.
export function nextFastStep(v: FastInputs): { step: FastStepKey } | { none: string } {
  if (v.visit === "Inspected") return { none: "This visit is already inspected — nothing left to fast-track before it." };
  if (!v.email.trim()) return { none: "Add the customer's email first — every step is an email." };
  if (v.twoMoEmail !== "Sent") return { step: "heads-up" };
  if (v.quote !== "Sent" && v.moneyPath !== "Invoice only") {
    if (!/[1-9]/.test(v.price)) return { none: "Add a price first — the quote needs one." };
    return { step: "quote" };
  }
  if (!v.maintConfirm) return { step: "safety" };
  if (v.scheduling !== "Sent") return { step: "scheduling" };
  if (v.accessReminder !== "Sent") {
    if (v.visit !== "Booked" || !v.tripDay) return { none: "Book the visit first (Visit → Booked and the trip day). Then the access reminder can be fast-tracked." };
    return { step: "access" };
  }
  return { none: "Every pre-visit email has gone out." };
}

export const FAST_MIN_LEAD_MS = 60 * 60 * 1000; // at least an hour out
export const FAST_MAX_LEAD_MS = 366 * 24 * 60 * 60 * 1000;
