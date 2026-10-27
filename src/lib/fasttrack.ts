// FAST TRACK, per step. Each of the five automatic pre-visit steps can be given
// its OWN date and time (tap the step in the elevator's Customer lifecycle list,
// pick a time, Save, "Are you sure?"). The app saves it in that step's column
// (BM–BQ, ISO UTC). Within 15 minutes after that time (any hour — see tick.ts), the step
// goes regardless of its usual due-date window, and the automation clears just
// that step's time (see archive/break-testing/fast-track-per-step.js).
//
// Order and spacing: a step's time must be at least an hour from now AND at
// least an hour after the step before it — so a whole chain can be set at once
// (8am, 9am, 10am…), one step per check at the most. A step can only be
// fast-tracked once every earlier step has gone or has its own time (otherwise
// it would just sit waiting for that earlier step).
//
// Pure (no server code) so the phone and the server agree on the rules.

export type FastStepKey = "heads-up" | "quote" | "safety" | "scheduling" | "access";
export const FAST_ORDER: FastStepKey[] = ["heads-up", "quote", "safety", "scheduling", "access"];

export const FAST_STEPS: Record<FastStepKey, { label: string; what: string; stage: string }> = {
  "heads-up": { label: "2-month heads-up email", what: "the 2-month heads-up email to the customer", stage: "twoMoEmail" },
  quote: { label: "Price quote email", what: "the price quote email (with the purchase order link) to the customer", stage: "quote" },
  safety: { label: "Safety-test question", what: "the safety-test question (to American Elevator if they maintain it, otherwise the customer)", stage: "maintConfirm" },
  scheduling: { label: "Scheduling email", what: "the scheduling email (with the booking link) to the customer", stage: "scheduling" },
  access: { label: "Access reminder", what: "the access reminder for the booked visit to the customer", stage: "accessReminder" },
};

// The fast-track step that belongs to a lifecycle stage (by the stage's key), if any.
export const fastStepForStage = (stageKey: string): FastStepKey | undefined =>
  FAST_ORDER.find((k) => FAST_STEPS[k].stage === stageKey);

// Each step's saved fast-track time (ISO UTC); missing = not fast-tracked.
export type FastTimes = Partial<Record<FastStepKey, string>>;

// The elevator's values by column name (from the dashboard row or the app's copy).
export type FastInputs = {
  email: string;
  price: string;
  moneyPath: string;
  twoMoEmail: string;
  quote: string;
  po: string;
  maintConfirm: string;
  scheduling: string;
  accessReminder: string;
  visit: string;
  tripDay: string;
};

// Where one step stands: already gone, not used for this elevator, can't be
// fast-tracked yet (and why), or open.
type StepState = { s: "sent" } | { s: "skip" } | { s: "blocked"; why: string } | { s: "open" };
function stepState(v: FastInputs, k: FastStepKey): StepState {
  if (v.visit === "Inspected") return { s: "blocked", why: "This visit is already inspected." };
  switch (k) {
    case "heads-up":
      if (v.twoMoEmail === "Sent") return { s: "sent" };
      break;
    case "quote":
      if (v.quote === "Sent") return { s: "sent" };
      if (v.moneyPath === "Invoice only") return { s: "skip" };
      if (!/[1-9]/.test(v.price)) return { s: "blocked", why: "Add a price first — the quote needs one." };
      break;
    case "safety":
      if (v.maintConfirm) return { s: "sent" };
      break;
    case "scheduling":
      if (v.scheduling === "Sent") return { s: "sent" };
      break;
    case "access":
      if (v.accessReminder === "Sent") return { s: "sent" };
      if (v.visit !== "Booked" || !v.tripDay) return { s: "blocked", why: "Book the visit first (Visit → Booked and the trip day)." };
      break;
  }
  if (!v.email.trim()) return { s: "blocked", why: "Add the customer's email first — every step is an email." };
  return { s: "open" };
}

export const FAST_MIN_LEAD_MS = 60 * 60 * 1000; // at least an hour out, and an hour between steps
// The automation checks on the quarter hour (:00, :15, :30, :45 — see tick.ts),
// so a fast-track time can only be one of those: the step goes at that time.
export const FAST_STEP_MIN = 15;
export const onQuarterHour = (d: Date) => !d.getUTCSeconds() && !d.getUTCMilliseconds() && d.getUTCMinutes() % FAST_STEP_MIN === 0;
// The first quarter-hour at or after `ms`.
export const upToQuarterHour = (ms: number) => Math.ceil(ms / (FAST_STEP_MIN * 60_000)) * FAST_STEP_MIN * 60_000;
export const FAST_MAX_LEAD_MS = 366 * 24 * 60 * 60 * 1000;
const t = (iso?: string) => (iso ? new Date(iso).getTime() : NaN);

// When step `k` may be set for: { min, max } (ms; max may be Infinity), or why it can't be.
//   min = an hour from now, and an hour after the latest earlier step's time
//   max = an hour before the earliest later step's time (a year out at most)
export function fastWindow(
  v: FastInputs,
  times: FastTimes,
  k: FastStepKey,
  now: number,
): { min: number; max: number } | { none: string; done?: boolean } {
  const st = stepState(v, k);
  if (st.s === "sent") return { none: `The ${FAST_STEPS[k].label.toLowerCase()} has already gone.`, done: true };
  if (st.s === "skip") return { none: "This elevator is invoice only — there's no quote email.", done: true };
  if (st.s === "blocked") return { none: st.why };
  const i = FAST_ORDER.indexOf(k);
  let min = now + FAST_MIN_LEAD_MS;
  for (const e of FAST_ORDER.slice(0, i)) {
    const es = stepState(v, e);
    if (es.s === "sent" || es.s === "skip") continue;
    const at = t(times[e]);
    if (Number.isNaN(at)) return { none: `Fast track the ${FAST_STEPS[e].label.toLowerCase()} first (or mark it Sent) — this step comes after it.` };
    min = Math.max(min, at + FAST_MIN_LEAD_MS);
  }
  let max = now + FAST_MAX_LEAD_MS;
  for (const l of FAST_ORDER.slice(i + 1)) {
    const at = t(times[l]);
    if (!Number.isNaN(at)) max = Math.min(max, at - FAST_MIN_LEAD_MS);
  }
  if (min > max) return { none: "The steps after this one are set too soon — change or cancel those first." };
  return { min, max };
}

// The first step that still needs a fast-track time (for the "Access fast track"
// shortcut on the elevator page), or why none can be set right now.
export function nextFastStep(v: FastInputs, times: FastTimes): { step: FastStepKey } | { none: string } {
  for (const k of FAST_ORDER) {
    const st = stepState(v, k);
    if (st.s === "sent" || st.s === "skip") continue;
    if (times[k]) continue; // already has a time — look further down the chain
    if (st.s === "blocked") return { none: st.why };
    return { step: k };
  }
  return { none: "" };
}

// Cancelling a step's fast track also cancels the steps after it (they'd only
// wait on it). Returns the steps that would be cleared, this one first.
export const fastCancelSet = (times: FastTimes, k: FastStepKey): FastStepKey[] =>
  FAST_ORDER.slice(FAST_ORDER.indexOf(k)).filter((x) => x === k || !!times[x]);
