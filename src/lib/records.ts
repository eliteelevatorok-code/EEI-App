// The "records" step before an inspection: has the elevator had a passing
// safety test in the last 12 months, and on what date?
//
// Who gets asked: Elite works with American Elevator, so if the elevator's
// maintenance company is American, the question goes to them. For any other
// maintenance company it goes straight to the CUSTOMER. (The Make automation's
// "Records needed" email uses the same rule — keep the two in step.)
//
// Anyone can also call April instead of using the form, and April or Robert can
// enter the answer by hand in the app (profile → Safety test).

export const APRIL = { name: "April Lassiter", phone: "(405) 708-0060", tel: "+14057080060" };

export const isAmerican = (maintCo?: string) => /american/i.test(maintCo ?? "");

// The answers, as stored on the dashboard (column AM). Older rows may still say
// Pass / Fail from the earlier question — read those as Yes / No.
export type SafetyAnswer = "Yes" | "No" | "";
export function safetyAnswer(raw?: string): SafetyAnswer {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "yes" || v === "pass") return "Yes";
  if (v === "no" || v === "fail") return "No";
  return "";
}

// Where to find the answer — said the same way in the email, the form and the app.
export const WHERE_TO_FIND =
  "Your elevator maintenance company can tell you, or it's on the yellow form in the maintenance log kept in the elevator machine room.";

// "8/4/2026" → "2026-08-04" (what a date picker needs); already-ISO dates pass through.
export function toIsoDate(s?: string): string {
  const v = (s ?? "").trim();
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}
