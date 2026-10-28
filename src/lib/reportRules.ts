import { isoToday } from "@/lib/records";

// Rules for a finished report, checked on the report screen and again by the
// server when it builds the PDF, so both always agree.

// No certificate (full or temporary) for a red-tagged, scrapped or inactive
// elevator — only when none of those is picked (Robert, 2026-10-28).
export const noCertificate = (condition: string) => condition === "Red Tag" || condition === "Scrapped" || condition === "Inactive";
// No next due date for a red-tagged or scrapped one.
export const noDueDate = (condition: string) => condition === "Red Tag" || condition === "Scrapped";

// A test date typed as MM/YYYY. Digits only, the slash goes in by itself, and it
// stops at 6 digits (a box that took any number of digits printed
// "10202265555" on a report — Robert, 2026-10-28).
export function typeMonthYear(v: string): string {
  if (/^\d{1,2}\/\d{0,4}$/.test(v)) return v; // already MM/YYYY-shaped (keeps a typed slash)
  const d = v.replace(/\D/g, "").slice(0, 6);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

// What's wrong with a MM/YYYY test date, in plain words — "" when it's fine.
export function monthYearProblem(s: string): string {
  const m = s.trim().match(/^(\d{1,2})\/(\d{4})$/);
  if (!m || +m[1] < 1 || +m[1] > 12) return "use MM/YYYY, like 10/2026";
  const [ty, tm] = isoToday().split("-").map(Number);
  const y = +m[2], mo = +m[1];
  if (y < ty - 10) return "that's more than 10 years ago";
  if (y > ty || (y === ty && mo > tm)) return "that's in the future";
  return "";
}
