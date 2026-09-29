import { driveFile } from "@/lib/google";
import { cell } from "@/lib/sheet";

// The finished inspection report for an elevator's CURRENT visit.
//
// Finishing a report in the app saves the filled PDF to Drive, keeps its link on
// the row (col AO) and writes the visit date into Trip day. The Make automation's
// "report filed" email (to the customer and the state) attaches this file.
//
// It only counts if the file's name carries this visit's date
// ("report-990012-9-11-2026.pdf" for Trip day 9/11/2026) — so last year's report
// is never sent for this year's visit. Null = no finished report for this visit.
export async function finishedReport(row: string[], withBytes = false) {
  const link = cell(row, "reportFile");
  const trip = cell(row, "tripDay").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!link || !trip) return null;
  const file = await driveFile(link, withBytes);
  const named = file?.name.match(/-(\d{1,2})-(\d{1,2})-(\d{4})\.pdf$/);
  if (!file || !named) return null;
  const sameDay = +named[1] === +trip[1] && +named[2] === +trip[2] && named[3] === trip[3];
  return sameDay ? file : null;
}
